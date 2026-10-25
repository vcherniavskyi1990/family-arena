// Збереження: один JSON-файл на колекцію в ARENA_DATA, запис атомарний (tmp + rename), з невеликою затримкою.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.cache = {};
    this.timers = {};
  }
  path(name) { return join(this.dir, `${name}.json`); }
  get(name, fallback) {
    if (!(name in this.cache)) {
      const p = this.path(name);
      this.cache[name] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : (typeof fallback === 'function' ? fallback() : fallback);
    }
    return this.cache[name];
  }
  set(name, value) { this.cache[name] = value; this.save(name); }
  /** Позначити колекцію зміненою: запис на диск через 200 мс (кілька змін підряд = один запис). */
  save(name) {
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => this.flush(name), 200);
    if (this.timers[name].unref) this.timers[name].unref();
  }
  flush(name) {
    clearTimeout(this.timers[name]);
    const p = this.path(name);
    writeFileSync(p + '.tmp', JSON.stringify(this.cache[name], null, 1));
    renameSync(p + '.tmp', p);
  }
  flushAll() { for (const n of Object.keys(this.cache)) this.flush(n); }
}
