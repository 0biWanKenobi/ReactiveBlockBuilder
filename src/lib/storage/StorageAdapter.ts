/** Paths are logical resource identifiers, not filesystem paths. */
export interface StorageAdapter {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(directory: string): Promise<string[]>;
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private prefix = 'rbb:') {}

  async read(path: string): Promise<string | null> {
    return localStorage.getItem(this.prefix + path);
  }

  async write(path: string, content: string): Promise<void> {
    localStorage.setItem(this.prefix + path, content);
  }

  async delete(path: string): Promise<void> {
    localStorage.removeItem(this.prefix + path);
  }

  async list(directory: string): Promise<string[]> {
    const prefix = this.prefix + directory.replace(/\/+$/, '') + '/';
    const paths: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) paths.push(key.slice(this.prefix.length));
    }
    return paths.sort();
  }
}
