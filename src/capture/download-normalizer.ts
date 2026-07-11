import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";

export interface NormalizedSheet {
  sheet_name: string;
  csv_filename: string;
  row_count: number;
  column_count: number;
  warnings: string[];
}

export interface DownloadNormalizationResult {
  schema_version: 1;
  download_id: string;
  source_filename: string;
  size: number;
  sha256: string;
  status: "NORMALIZED" | "UNSUPPORTED_FORMAT" | "FAILED";
  sheets: NormalizedSheet[];
  warnings: string[];
}

export async function normalizeDownload(input: { download_id: string; source_path: string; output_dir: string }): Promise<DownloadNormalizationResult> {
  const extension = path.extname(input.source_path).toLowerCase();
  if (extension === ".xls") return base(input, Buffer.alloc(0), "UNSUPPORTED_FORMAT", ["UNSUPPORTED_FORMAT:.xls"]);
  if (![".csv", ".xlsx"].includes(extension)) return base(input, Buffer.alloc(0), "UNSUPPORTED_FORMAT", [`UNSUPPORTED_FORMAT:${extension || "none"}`]);
  const source = await fs.promises.readFile(input.source_path).catch(() => undefined);
  if (!source) return base(input, Buffer.alloc(0), "FAILED", ["SOURCE_UNREADABLE"]);
  await fs.promises.mkdir(input.output_dir, { recursive: true, mode: 0o700 });
  try {
    const workbook = new ExcelJS.Workbook();
    if (extension === ".csv") await workbook.csv.readFile(input.source_path);
    else await workbook.xlsx.load(source as unknown as ExcelJS.Buffer);
    const sheets: NormalizedSheet[] = [];
    for (const sheet of [...workbook.worksheets].sort((a, b) => a.name.localeCompare(b.name))) {
      const sheetName = sheet.name;
      const filename = `${input.download_id}-${safeName(sheetName)}.csv`;
      const csv = normalizeNewlines(rowsToCsv(sheet));
      await fs.promises.writeFile(path.join(input.output_dir, filename), csv, { mode: 0o600 });
      sheets.push({
        sheet_name: sheetName,
        csv_filename: filename,
        row_count: sheet.actualRowCount,
        column_count: sheet.actualColumnCount,
        warnings: []
      });
    }
    return { ...base(input, source, "NORMALIZED", []), sheets };
  } catch (error) {
    return base(input, source, "FAILED", [`CONVERSION_FAILED:${error instanceof Error ? error.message : String(error)}`]);
  }
}

function rowsToCsv(sheet: ExcelJS.Worksheet): string {
  const lines: string[] = [];
  for (let rowNumber = 1; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells: string[] = [];
    for (let column = 1; column <= sheet.actualColumnCount; column += 1) cells.push(csvCell(cellText(row.getCell(column).value)));
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value) return String(value.text);
    if ("result" in value) return String(value.result ?? "");
    return JSON.stringify(value);
  }
  return String(value);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function base(input: { download_id: string; source_path: string }, source: Buffer, status: DownloadNormalizationResult["status"], warnings: string[]): DownloadNormalizationResult {
  return {
    schema_version: 1,
    download_id: input.download_id,
    source_filename: path.basename(input.source_path),
    size: source.byteLength,
    sha256: createHash("sha256").update(source).digest("hex"),
    status,
    sheets: [],
    warnings
  };
}

function safeName(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return normalized || "sheet";
}

function normalizeNewlines(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}
