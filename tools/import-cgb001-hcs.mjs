#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const upstreamRoot = path.join(modelDir, "reference", "upstream");
const hcsCommit = "e688fc51141c0974728aa1bdcb89b94d74123f6b";
const defaultHcsDirectory = path.join(upstreamRoot, "hcs", hcsCommit);
const defaultCieDirectory = path.join(upstreamRoot, "cie");
const defaultOutput = path.join(modelDir, "data", "hcs-source-v1.json");

const expectedHcsArtifacts = [
  {
    fileName: "gbc_reflectance.ods",
    relativePath: "measurements/gbc_reflectance.ods",
    sha256: "967af7247d940e15cd86ce28046fcf9996bb36086389d9967154188770a95bba",
    role: "complete source measurement workbook",
  },
  {
    fileName: "gbc_reflectance.txt",
    relativePath: "measurements/gbc_reflectance.txt",
    sha256: "b985e02476d35beecfb6a6955cb8aecae052205008126a8cdad7fd7233cf2b37",
    role: "source text export cross-check",
  },
  {
    fileName: "GBC_illuminant_D65_params.csv",
    relativePath: "report/GBC_illuminant_D65_params.csv",
    sha256: "1126ac8104f27c3a590a19c59ab605395cca9b9ca86bd5f52b00ff3a13ffa86c",
    role: "upstream-derived D65 comparison fixture",
  },
];

const expectedCieArtifacts = [
  {
    fileName: "CIE_xyz_1931_2deg.csv",
    sha256: "fa663e3535a7e0763a745993a1f0a192eb0275ac46ad2d1befd7626841e713c1",
    role: "CIE 1931 2 degree colour-matching functions",
    doi: "10.25039/CIE.DS.xvudnb9b",
  },
  {
    fileName: "CIE_xyz_1931_2deg.csv_metadata.json",
    sha256: "03abcaecf4e63d77045ef57c4514b52c8bb1a46dd18e1f93a50044a0f4f481c8",
    role: "CIE observer metadata",
  },
  {
    fileName: "CIE_std_illum_D65.csv",
    sha256: "e76f210bffff3d552ef7113025da5f325d5dfec200dd4b878b1a2f3a507032cb",
    role: "CIE standard illuminant D65",
    doi: "10.25039/CIE.DS.hjfjmt59",
  },
  {
    fileName: "CIE_std_illum_D65.csv_metadata_v2.json",
    sha256: "71994379b81c65db111f652e747a00b599b5456c2a8242e9a0d6f379f560a14e",
    role: "CIE D65 metadata",
  },
];

const expectedSheets = ["R", "G", "B", "Y", "C", "M", "Greyscale", "Summary"];
const rampSheets = expectedSheets.slice(0, 7);

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cleanNumber(value, digits = 12) {
  if (!Number.isFinite(value)) return value;
  const cleaned = Number(value.toFixed(digits));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function cleanDeep(value) {
  if (typeof value === "number") return cleanNumber(value);
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item)]));
  }
  return value;
}

function verifyFile(file, expectedHash, label) {
  assert(fs.existsSync(file), `missing ${label}: ${file}`);
  const actual = sha256(fs.readFileSync(file));
  assert(actual === expectedHash,
    `${label} hash mismatch: expected ${expectedHash}, received ${actual}; import was not started`);
  return actual;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ODS ZIP end-of-central-directory record not found");
}

function readZipEntry(buffer, wantedName) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entryCount; index += 1) {
    assert(buffer.readUInt32LE(offset) === 0x02014b50, "invalid ODS ZIP central-directory entry");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === wantedName) {
      assert(buffer.readUInt32LE(localOffset) === 0x04034b50, `invalid local ZIP header for ${wantedName}`);
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      const output = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
      assert(output, `unsupported ZIP compression method ${method} for ${wantedName}`);
      assert(output.length === uncompressedSize, `${wantedName}: uncompressed length mismatch`);
      return output;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ODS ZIP entry not found: ${wantedName}`);
}

function decodeXml(value) {
  return value
    .replace(/<text:line-break\s*\/>/g, "\n")
    .replace(/<text:tab\s*\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function xmlAttribute(attributes, name) {
  const match = (attributes ?? "").match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

function parseOdsCell(attributes, body = "") {
  const type = xmlAttribute(attributes, "office:value-type");
  const formula = xmlAttribute(attributes, "table:formula");
  let value = null;
  if (type === "float" || type === "percentage" || type === "currency") {
    value = Number(xmlAttribute(attributes, "office:value"));
  } else if (type === "boolean") {
    value = xmlAttribute(attributes, "office:boolean-value") === "true";
  } else if (type === "string") {
    const explicit = xmlAttribute(attributes, "office:string-value");
    value = explicit ?? [...body.matchAll(/<text:p(?:\s[^>]*)?>([\s\S]*?)<\/text:p>/g)]
      .map((match) => decodeXml(match[1])).join("\n");
  } else {
    const paragraphs = [...body.matchAll(/<text:p(?:\s[^>]*)?>([\s\S]*?)<\/text:p>/g)]
      .map((match) => decodeXml(match[1])).join("\n");
    if (paragraphs) value = paragraphs;
  }
  return { value, formula };
}

function parseOdsRows(tableBody) {
  const rows = [];
  const rowPattern = /<table:table-row(?:\s+([^>]*))?>([\s\S]*?)<\/table:table-row>/g;
  for (const rowMatch of tableBody.matchAll(rowPattern)) {
    const rowRepeat = Number(xmlAttribute(rowMatch[1], "table:number-rows-repeated") ?? 1);
    assert(rowRepeat <= 10000, "unreasonable repeated ODS row count");
    const cells = [];
    const cellPattern = /<table:(table-cell|covered-table-cell)(?:\s+([^>]*?))?(?:\/>|>([\s\S]*?)<\/table:\1>)/g;
    for (const cellMatch of rowMatch[2].matchAll(cellPattern)) {
      const repeat = Number(xmlAttribute(cellMatch[2], "table:number-columns-repeated") ?? 1);
      assert(repeat <= 10000, "unreasonable repeated ODS column count");
      const cell = parseOdsCell(cellMatch[2], cellMatch[3] ?? "");
      for (let index = 0; index < repeat; index += 1) cells.push(cell);
    }
    while (cells.length > 0 && cells.at(-1).value === null && !cells.at(-1).formula) cells.pop();
    for (let index = 0; index < rowRepeat; index += 1) rows.push(cells);
  }
  return rows;
}

export function parseOdsWorkbook(buffer) {
  const xml = readZipEntry(buffer, "content.xml").toString("utf8");
  const sheets = new Map();
  const tablePattern = /<table:table\s+([^>]*)>([\s\S]*?)<\/table:table>/g;
  for (const match of xml.matchAll(tablePattern)) {
    const name = xmlAttribute(match[1], "table:name");
    assert(name && !sheets.has(name), `invalid or duplicate ODS sheet name: ${name}`);
    sheets.set(name, parseOdsRows(match[2]));
  }
  return sheets;
}

function extractMeasurementTable(rows, sheetName, options = {}) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.value === "Reading"));
  assert(headerIndex >= 0, `${sheetName}: Reading header not found`);
  const header = rows[headerIndex].map((cell) => cell.value);
  const readingColumn = header.indexOf("Reading");
  const xColumn = header.indexOf("X");
  const yColumn = header.indexOf("Y");
  const zColumn = header.indexOf("Z");
  const lColumn = header.indexOf("L*");
  const aColumn = header.indexOf("a*");
  const bColumn = header.indexOf("b*");
  const wavelengthColumns = header
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => typeof value === "number" && value >= 300 && value <= 900);
  assert([readingColumn, xColumn, yColumn, zColumn, lColumn, aColumn, bColumn].every((item) => item >= 0),
    `${sheetName}: incomplete XYZ/Lab header`);
  assert(wavelengthColumns.length === 36, `${sheetName}: expected 36 wavelength columns, got ${wavelengthColumns.length}`);
  assert(wavelengthColumns[0].value === 380 && wavelengthColumns.at(-1).value === 730,
    `${sheetName}: unexpected wavelength range`);

  const records = [];
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const reading = row[readingColumn]?.value;
    const validReading = typeof reading === "number"
      || (options.allowStringReadings && typeof reading === "string" && reading.length > 0);
    if (!validReading) continue;
    const spectrum = wavelengthColumns.map(({ value: wavelengthNm, index }) => {
      const reflectance = row[index]?.value;
      assert(typeof reflectance === "number" && Number.isFinite(reflectance),
        `${sheetName} reading ${reading}: invalid reflectance at ${wavelengthNm} nm`);
      return { wavelengthNm, reflectance };
    });
    records.push({
      sourceRow: rowIndex + 1,
      reading,
      sourceReportedXyz: [row[xColumn]?.value, row[yColumn]?.value, row[zColumn]?.value],
      sourceReportedLab: [row[lColumn]?.value, row[aColumn]?.value, row[bColumn]?.value],
      spectrum,
    });
  }
  return { headerIndex: headerIndex + 1, header, records };
}

function parseTabExport(source) {
  const lines = source.split(/\r?\n/);
  const rows = [];
  let blankSeparatorCount = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      if (index > 0 && index < lines.length - 1) blankSeparatorCount += 1;
      continue;
    }
    const values = line.split("\t");
    if (index === 0) continue;
    assert(values.length === 43, `TXT row ${index + 1}: expected 43 columns, got ${values.length}`);
    const numeric = values.map(Number);
    assert(numeric.every(Number.isFinite), `TXT row ${index + 1}: non-numeric field`);
    rows.push({
      sourceLine: index + 1,
      reading: numeric[0],
      sourceReportedXyz: numeric.slice(1, 4),
      sourceReportedLab: numeric.slice(4, 7),
      spectrum: numeric.slice(7).map((reflectance, wavelengthIndex) => ({
        wavelengthNm: 380 + wavelengthIndex * 10,
        reflectance,
      })),
    });
  }
  return { rows, blankSeparatorCount };
}

function parseNumericCsv(source, expectedColumns) {
  const rows = source.trim().split(/\r?\n/).map((line, index) => {
    const values = line.split(",").map(Number);
    assert(values.length === expectedColumns && values.every(Number.isFinite),
      `numeric CSV row ${index + 1}: expected ${expectedColumns} finite columns`);
    return values;
  });
  return rows;
}

function linearSample(samples, wavelengthNm) {
  if (wavelengthNm <= samples[0].wavelengthNm) return samples[0].reflectance;
  if (wavelengthNm >= samples.at(-1).wavelengthNm) return samples.at(-1).reflectance;
  const position = (wavelengthNm - samples[0].wavelengthNm) / 10;
  const lower = Math.floor(position);
  const amount = position - lower;
  return samples[lower].reflectance * (1 - amount) + samples[lower + 1].reflectance * amount;
}

function buildCieContext(cieDirectory) {
  const files = {};
  for (const artifact of expectedCieArtifacts) {
    const file = path.join(cieDirectory, artifact.fileName);
    verifyFile(file, artifact.sha256, `CIE reference ${artifact.fileName}`);
    files[artifact.fileName] = file;
  }
  const observerRows = parseNumericCsv(fs.readFileSync(files["CIE_xyz_1931_2deg.csv"], "utf8"), 4);
  const d65Rows = parseNumericCsv(fs.readFileSync(files["CIE_std_illum_D65.csv"], "utf8"), 2);
  const observer = new Map(observerRows.map(([wavelength, x, y, z]) => [wavelength, [x, y, z]]));
  const d65 = new Map(d65Rows.map(([wavelength, value]) => [wavelength, value]));
  for (let wavelength = 360; wavelength <= 830; wavelength += 1) {
    assert(observer.has(wavelength), `CIE observer missing ${wavelength} nm`);
    assert(d65.has(wavelength), `CIE D65 missing ${wavelength} nm`);
  }
  return { files, observer, d65 };
}

export function integrateReflectanceD65(spectrum, cie, range = [380, 730]) {
  const [minimum, maximum] = range;
  let denominator = 0;
  const numerator = [0, 0, 0];
  for (let wavelength = minimum; wavelength <= maximum; wavelength += 1) {
    const illuminant = cie.d65.get(wavelength);
    const observer = cie.observer.get(wavelength);
    const reflectance = linearSample(spectrum, wavelength);
    denominator += illuminant * observer[1];
    for (let channel = 0; channel < 3; channel += 1) {
      numerator[channel] += reflectance * illuminant * observer[channel];
    }
  }
  return numerator.map((value) => value / denominator);
}

function referenceWhiteD65(cie, range) {
  const synthetic = [];
  for (let wavelength = 380; wavelength <= 730; wavelength += 10) {
    synthetic.push({ wavelengthNm: wavelength, reflectance: 1 });
  }
  return integrateReflectanceD65(synthetic, cie, range);
}

function compareRecord(a, b, tolerance = 1e-12, compareReading = true) {
  if (compareReading && a.reading !== b.reading) return false;
  const valuesA = [...a.sourceReportedXyz, ...a.sourceReportedLab, ...a.spectrum.map((item) => item.reflectance)];
  const valuesB = [...b.sourceReportedXyz, ...b.sourceReportedLab, ...b.spectrum.map((item) => item.reflectance)];
  return valuesA.length === valuesB.length
    && valuesA.every((value, index) => Math.abs(value - valuesB[index]) <= tolerance);
}

function monotonicViolations(values) {
  const output = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) {
      output.push({
        previousIndex: index - 1,
        currentIndex: index,
        previousValue: values[index - 1],
        currentValue: values[index],
        drop: values[index] - values[index - 1],
      });
    }
  }
  return output;
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values;
}

function parseUpstreamD65Parameters(source) {
  const lines = source.split(/\r?\n/);
  const blackPoints = {};
  const polynomials = {};
  const matrixColumns = {};
  const secondaryScales = {};
  let section = null;
  for (const line of lines) {
    if (line.startsWith("# Black point")) section = "black";
    else if (line.startsWith('"# Gamma')) section = "gamma";
    else if (line.startsWith('"# RGB linear')) section = "matrix";
    else if (line.startsWith("# Secondary")) section = "secondary";
    else if (!line || line.startsWith("#") || line.startsWith('"#')) continue;
    else {
      const fields = parseCsvLine(line);
      if (section === "black" && fields.length === 4 && fields[0] !== "file") {
        blackPoints[fields[0]] = fields.slice(1).map(Number);
      } else if (section === "gamma" && /^[RGB]$/.test(fields[0] ?? "")) {
        polynomials[fields[0]] = {
          degree: Number(fields[1]),
          rmse: Number(fields[2]),
          coefficients: fields.slice(3).map(Number),
        };
      } else if (section === "matrix" && /^[RGB]$/.test(fields[0] ?? "")) {
        matrixColumns[fields[0]] = fields.slice(1).map(Number);
      } else if (section === "secondary" && /^(yellow|cyan|magenta|gray)$/.test(fields[0] ?? "")) {
        secondaryScales[fields[0]] = {
          k: Number(fields[1]),
          meanDeltaECam16Ucs: Number(fields[2]),
          standardDeviationDeltaECam16Ucs: Number(fields[3]),
        };
      }
    }
  }
  assert(Object.keys(blackPoints).length === 8, "upstream D65 fixture black-point table is incomplete");
  assert(Object.keys(polynomials).length === 3, "upstream D65 fixture polynomial table is incomplete");
  assert(Object.keys(matrixColumns).length === 3, "upstream D65 fixture matrix is incomplete");
  assert(Object.keys(secondaryScales).length === 4, "upstream D65 fixture secondary table is incomplete");
  return { blackPoints, polynomials, matrixColumns, secondaryScales };
}

export function loadHcsReference(options = {}) {
  const hcsDirectory = path.resolve(options.hcsDirectory ?? defaultHcsDirectory);
  const cieDirectory = path.resolve(options.cieDirectory ?? defaultCieDirectory);
  const hcsFiles = {};
  const sourceArtifacts = [];
  for (const artifact of expectedHcsArtifacts) {
    const file = path.join(hcsDirectory, artifact.relativePath);
    const actual = verifyFile(file, artifact.sha256, `HCS reference ${artifact.fileName}`);
    hcsFiles[artifact.fileName] = file;
    sourceArtifacts.push({
      fileName: artifact.fileName,
      repositoryPath: `${modelRelative}/reference/upstream/hcs/${hcsCommit}/${artifact.relativePath}`,
      sha256: actual,
      verified: true,
      role: artifact.role,
    });
  }
  const cie = buildCieContext(cieDirectory);
  const workbook = parseOdsWorkbook(fs.readFileSync(hcsFiles["gbc_reflectance.ods"]));
  assert(workbook.size === expectedSheets.length, `expected ${expectedSheets.length} ODS sheets, got ${workbook.size}`);
  assert(expectedSheets.every((name) => workbook.has(name)), "ODS sheet inventory drifted");
  const tables = Object.fromEntries(expectedSheets.map((name) => [
    name,
    extractMeasurementTable(workbook.get(name), name, { allowStringReadings: name === "Summary" }),
  ]));
  const textExport = parseTabExport(fs.readFileSync(hcsFiles["gbc_reflectance.txt"], "utf8"));
  const upstreamD65 = parseUpstreamD65Parameters(
    fs.readFileSync(hcsFiles["GBC_illuminant_D65_params.csv"], "utf8"),
  );
  return { hcsDirectory, cieDirectory, hcsFiles, sourceArtifacts, cie, tables, textExport, upstreamD65 };
}

export function buildMeasurementRecord(options = {}) {
  const source = loadHcsReference(options);
  const fullRange = [380, 730];
  const validRange = [440, 700];
  const series = {};
  const allNegativeSamples = [];
  for (const name of rampSheets) {
    const table = source.tables[name];
    const readings = table.records.map((record, index) => {
      const negativeSamples = record.spectrum.filter((sample) => sample.reflectance < 0);
      for (const sample of negativeSamples) {
        allNegativeSamples.push({ sheet: name, sourceReading: record.reading, ...sample });
      }
      return {
        sourceReading: record.reading,
        sourceRow: record.sourceRow,
        normalizedSourceIndex: record.reading === 1 ? 0 : index / (table.records.length - 1),
        sourceReportedXyz: record.sourceReportedXyz,
        sourceReportedLab: record.sourceReportedLab,
        d65XyzRecordedRange: integrateReflectanceD65(record.spectrum, source.cie, fullRange),
        d65XyzAuthorUsableRange: integrateReflectanceD65(record.spectrum, source.cie, validRange),
        spectrumAudit: {
          sampleCount: record.spectrum.length,
          minimum: Math.min(...record.spectrum.map((sample) => sample.reflectance)),
          maximum: Math.max(...record.spectrum.map((sample) => sample.reflectance)),
          negativeSampleCount: negativeSamples.length,
          samplesBelow440Nm: record.spectrum.filter((sample) => sample.wavelengthNm < 440).length,
        },
      };
    });
    const expectedCount = 32;
    const mapping = readings.length === expectedCount
      ? "identity-reading-minus-one"
      : "endpoint-preserving-uniform-source-index-resample-v1";
    series[name] = {
      sourcePatchCount: readings.length,
      expectedCodeCount: expectedCount,
      countDelta: readings.length - expectedCount,
      codeMappingPolicy: mapping,
      mappingClassification: readings.length === expectedCount ? "measured" : "derived",
      sourceHeaderRow: table.headerIndex,
      sourceReadingRange: [readings[0].sourceReading, readings.at(-1).sourceReading],
      wavelengthGridNm: {
        minimum: 380,
        maximum: 730,
        step: 10,
        count: 36,
      },
      monotonicViolationsRecordedRangeY: monotonicViolations(readings.map((item) => item.d65XyzRecordedRange[1])),
      readings,
    };
  }

  const summary = source.tables.Summary.records.map((record) => ({
    sourceReading: record.reading,
    sourceRow: record.sourceRow,
    sourceReportedXyz: record.sourceReportedXyz,
    sourceReportedLab: record.sourceReportedLab,
    d65XyzRecordedRange: integrateReflectanceD65(record.spectrum, source.cie, fullRange),
    d65XyzAuthorUsableRange: integrateReflectanceD65(record.spectrum, source.cie, validRange),
  }));
  assert(summary.length === 5, `Summary: expected 5 readings, got ${summary.length}`);

  const txtRamp = source.textExport.rows.slice(0, 32);
  const txtSummary = source.textExport.rows.slice(32);
  const txtRampMismatches = txtRamp.filter((record, index) => !compareRecord(record, source.tables.Greyscale.records[index]));
  const txtSummaryMismatches = txtSummary.filter((record, index) => !compareRecord(
    record,
    source.tables.Summary.records[index],
    1e-12,
    false,
  ));
  const blackPoints = Object.fromEntries(rampSheets.map((name) => [name, series[name].readings[0].d65XyzRecordedRange]));
  const blackRanges = [0, 1, 2].map((channel) => {
    const values = Object.values(blackPoints).map((xyz) => xyz[channel]);
    return { minimum: Math.min(...values), maximum: Math.max(...values), range: Math.max(...values) - Math.min(...values) };
  });

  const record = {
    schemaVersion: 1,
    recordId: "cgb001-hcs-source-v1",
    modelId: "nintendo-cgb-001-period-reconstruction",
    classification: "measured-normalization",
    status: "complete",
    evidenceIds: ["CGB-HCS-REFLECTANCE-2026"],
    sourceLocation: {
      repository: "https://github.com/Brankale/Handheld-Color-Space-Project",
      commit: hcsCommit,
      upstreamDirectory: "handhelds/Nintendo GBC/[2026-05-xx][Pokefan531][WIP]",
      localReferenceRoot: `${modelRelative}/reference/upstream/hcs/${hcsCommit}`,
      storagePolicy: "verbatim attributed scientific reference; never overwritten by normalization",
    },
    sourceArtifacts: source.sourceArtifacts,
    cieReferences: expectedCieArtifacts.map((artifact) => ({
      fileName: artifact.fileName,
      repositoryPath: `${modelRelative}/reference/upstream/cie/${artifact.fileName}`,
      sha256: artifact.sha256,
      verified: true,
      role: artifact.role,
      ...(artifact.doi ? { doi: artifact.doi } : {}),
      license: "CC BY-SA 4.0",
    })),
    geometry: {
      illuminationAngleDegrees: 45,
      detectorAngleDegrees: 0,
      detectorDirection: "panel normal",
    },
    audit: {
      expectedSheetNames: expectedSheets,
      sheetCount: expectedSheets.length,
      seriesPatchCounts: Object.fromEntries(rampSheets.map((name) => [name, series[name].sourcePatchCount])),
      invalidWavelengthPolicy: "The default source-recorded reference preserves 380-730 nm exactly as accepted by the user; an independently reported 440-700 nm sensitivity path exposes the source author's invalid-<440-nm warning and the instrument's upper-range concern.",
      recordedIntegrationRangeNm: fullRange,
      authorUsableSensitivityRangeNm: validRange,
      negativeReflectancePresent: allNegativeSamples.length > 0,
      negativeReflectanceSampleCount: allNegativeSamples.length,
      negativeReflectanceExamples: allNegativeSamples.slice(0, 24),
      blackDriftPresent: blackRanges.some((item) => item.range > 0),
      blackPointsD65RecordedRange: blackPoints,
      blackPointComponentRanges: { X: blackRanges[0], Y: blackRanges[1], Z: blackRanges[2] },
      xyzAdditivityFailureRecordedBySource: true,
      upstreamManualEditsPresent: true,
      txtCrossCheck: {
        rowCount: source.textExport.rows.length,
        blankSeparatorCount: source.textExport.blankSeparatorCount,
        expectedComposition: "32 Greyscale readings followed by 5 Summary readings",
        greyscaleMismatchCount: txtRampMismatches.length,
        summaryMismatchCount: txtSummaryMismatches.length,
        pass: txtRampMismatches.length === 0 && txtSummaryMismatches.length === 0,
      },
    },
    normalizationPolicy: {
      rawMutation: false,
      spectraStoredInNormalizedRecord: false,
      spectraAccess: "read verbatim from the pinned ODS for every rebuild",
      exactCountSeries: "reading n maps to RGB555 code n-1",
      rAndGCountMismatch: "No missing/extra code identity is invented. Ordered readings are placed on a uniform source-index axis spanning code 0 through 31 and resampled only in the derived model.",
      monotonicRepair: "Raw and integrated readings remain unchanged here; any monotonic projection is a separately reported color-model transform.",
      blackPolicy: "All per-series black readings and the dedicated Summary black remain separate facts.",
    },
    d65Integration: {
      method: "linearly interpolate the source 10 nm reflectance to the verbatim CIE 1 nm grid, multiply by CIE D65 and CIE 1931 2 degree CMFs, and normalize Y over the same declared wavelength range",
      recordedRangeWhiteXyz: referenceWhiteD65(source.cie, fullRange),
      authorUsableRangeWhiteXyz: referenceWhiteD65(source.cie, validRange),
      classification: "derived directly from verbatim measurements and verbatim CIE standard tables",
    },
    normalizedSeries: series,
    summaryReadings: summary,
    upstreamD65Fixture: {
      classification: "upstream-derived comparison; not the project reference model",
      sourceFile: `${modelRelative}/reference/upstream/hcs/${hcsCommit}/report/GBC_illuminant_D65_params.csv`,
      sourceSha256: expectedHcsArtifacts[2].sha256,
      parameters: source.upstreamD65,
    },
    outputs: [
      "data/color-reference-v1.json",
      "generated/ws1-color-audit-v1.json",
      "generated/cgb001-d65-lut-v1.rgba32f",
    ],
  };
  return cleanDeep(record);
}

function parseArguments(argv) {
  const options = { checkOnly: false, hcsDirectory: defaultHcsDirectory, cieDirectory: defaultCieDirectory, output: defaultOutput };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.checkOnly = true;
    else if (["--source", "--cie-source", "--output"].includes(argument)) {
      assert(index + 1 < argv.length, `${argument} requires a path`);
      const value = path.resolve(argv[index + 1]);
      if (argument === "--source") options.hcsDirectory = value;
      else if (argument === "--cie-source") options.cieDirectory = value;
      else options.output = value;
      index += 1;
    } else if (argument === "--help") {
      console.log("Usage: node tools/import-cgb001-hcs.mjs [--check] [--source <pinned-HCS-dir>] [--cie-source <CIE-dir>] [--output <json>]");
      return null;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) return;
  const expected = `${JSON.stringify(buildMeasurementRecord(options), null, 2)}\n`;
  if (options.checkOnly) {
    assert(fs.existsSync(options.output), `missing normalized HCS record: ${path.relative(root, options.output)}`);
    assert(fs.readFileSync(options.output, "utf8") === expected,
      `${path.relative(root, options.output)} is stale; run node tools/import-cgb001-hcs.mjs`);
    console.log("CGB-001 verbatim HCS reference and normalized source record are current.");
  } else {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, expected);
    console.log(`Wrote ${path.relative(root, options.output)}`);
  }
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try {
    main();
  } catch (error) {
    console.error(`CGB-001 HCS import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
