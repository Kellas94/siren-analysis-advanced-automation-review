import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';

export function formatDuckDBDecimal(decimalValue) {
  if (!decimalValue || typeof decimalValue !== 'object') return String(decimalValue);
  const scale = decimalValue.scale || 0;
  let rawBigInt = decimalValue.value;
  if (typeof rawBigInt !== 'bigint') {
    rawBigInt = BigInt(rawBigInt || 0);
  }
  if (scale === 0) return rawBigInt.toString();

  const isNegative = rawBigInt < 0n;
  const absBigInt = isNegative ? -rawBigInt : rawBigInt;
  const str = absBigInt.toString();

  let formatted;
  if (str.length <= scale) {
    formatted = `0.${str.padStart(scale, '0')}`;
  } else {
    const intPart = str.slice(0, str.length - scale);
    const fracPart = str.slice(str.length - scale);
    formatted = `${intPart}.${fracPart}`;
  }
  return isNegative ? `-${formatted}` : formatted;
}

export function safeJsonStringify(data, space = 2) {
  return JSON.stringify(data, (key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value === 'object' && value.constructor?.name === 'DuckDBDecimalValue') {
      return formatDuckDBDecimal(value);
    }
    return value;
  }, space);
}

export class DuckDBRunner {
  constructor(options = {}) {
    this.options = {
      dbPath: options.dbPath || ':memory:',
      maxMemory: options.maxMemory || '4GB',
      threads: options.threads || 8,
      tempDirectory: options.tempDirectory || 'D:\\Siren analysis prototype\\data\\temp',
      ...options
    };
    this.instance = null;
    this.connection = null;
    this.currentStatement = null;
    this.cancelled = false;
  }

  async initialize() {
    if (!fs.existsSync(this.options.tempDirectory)) {
      fs.mkdirSync(this.options.tempDirectory, { recursive: true });
    }

    const config = {
      max_memory: this.options.maxMemory,
      threads: String(this.options.threads),
      temp_directory: this.options.tempDirectory
    };

    this.instance = await DuckDBInstance.create(this.options.dbPath, config);
    this.connection = await this.instance.connect();

    // Verify settings applied
    const res = await this.run("SELECT current_setting('max_memory') AS max_mem, current_setting('threads') AS threads, current_setting('temp_directory') AS temp_dir");
    const rows = await res.getRows();
    return {
      version: 'v2.0.0',
      maxMemory: rows[0][0],
      threads: Number(rows[0][1]),
      tempDirectory: rows[0][2]
    };
  }

  async run(sql) {
    if (!this.connection) throw new Error('DuckDB connection not initialized');
    return await this.connection.run(sql);
  }

  async queryRows(sql) {
    const res = await this.run(sql);
    return await res.getRowsJson();
  }

  async queryRawRows(sql) {
    const res = await this.run(sql);
    return await res.getRows();
  }

  async queryObjects(sql) {
    const res = await this.run(sql);
    return await res.getRowObjectsJson();
  }

  /**
   * Bounded preview query: NEVER fetches more than limit rows into Node memory.
   */
  async getPreview(tableNameOrView, limit = 50, offset = 0) {
    const sql = `SELECT * FROM ${tableNameOrView} LIMIT ${limit} OFFSET ${offset}`;
    return await this.queryObjects(sql);
  }

  async getTableSchema(tableNameOrView) {
    const sql = `DESCRIBE ${tableNameOrView}`;
    const rows = await this.queryObjects(sql);
    return rows.map(r => ({
      name: r.column_name,
      type: r.column_type,
      columnName: r.column_name,
      columnType: r.column_type,
      nullable: r.null === 'YES',
      default: r.default,
      key: r.key
    }));
  }

  async getTableRowCount(tableNameOrView) {
    const sql = `SELECT COUNT(*)::BIGINT AS total_count FROM ${tableNameOrView}`;
    const rows = await this.queryRows(sql);
    return Number(rows[0][0]);
  }

  getMemoryUsage() {
    const mem = process.memoryUsage();
    return {
      rssMB: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024)),
      heapTotalMB: Math.round(mem.heapTotal / (1024 * 1024)),
      externalMB: Math.round(mem.external / (1024 * 1024))
    };
  }

  getTempDiskUsageBytes() {
    const tempDir = this.options.tempDirectory;
    if (!fs.existsSync(tempDir)) return 0;
    let total = 0;
    const entries = fs.readdirSync(tempDir);
    for (const f of entries) {
      try {
        const s = fs.statSync(path.join(tempDir, f));
        if (s.isFile()) total += s.size;
      } catch (e) {}
    }
    return total;
  }

  cleanTempDirectory() {
    const tempDir = this.options.tempDirectory;
    if (!fs.existsSync(tempDir)) return;
    const entries = fs.readdirSync(tempDir);
    for (const f of entries) {
      try {
        fs.unlinkSync(path.join(tempDir, f));
      } catch (e) {}
    }
  }

  interrupt() {
    this.cancelled = true;
    if (this.connection && typeof this.connection.interrupt === 'function') {
      try {
        this.connection.interrupt();
      } catch (e) {}
    }
  }

  async close() {
    this.cancelled = true;
    if (this.connection) {
      try {
        if (typeof this.connection.closeSync === 'function') {
          this.connection.closeSync();
        } else if (typeof this.connection.disconnectSync === 'function') {
          this.connection.disconnectSync();
        }
      } catch (e) {}
      this.connection = null;
    }
    if (this.instance) {
      try {
        if (typeof this.instance.closeSync === 'function') {
          this.instance.closeSync();
        }
      } catch (e) {}
      this.instance = null;
    }
  }
}
