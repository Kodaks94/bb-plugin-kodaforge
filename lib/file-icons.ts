// Which Material Icon Theme icon a file or folder gets, the way VS Code picks it:
// exact file name, then the longest matching extension ("d.ts" before "ts"),
// then the language behind the extension, then the default.

export interface IconMap {
  file: string;
  folder: string;
  folderOpen: string;
  names: Record<string, string>;
  extensions: Record<string, string>;
  languages: Record<string, string>;
  folders: Record<string, string>;
  foldersOpen: Record<string, string>;
  light: {
    names: Record<string, string>;
    extensions: Record<string, string>;
    folders: Record<string, string>;
    foldersOpen: Record<string, string>;
  };
}

export function fileIcon(map: IconMap, path: string, light = false): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const byName = (light && map.light.names[name]) || map.names[name];
  if (byName) return byName;
  // "foo.spec.ts" tries "spec.ts", then "ts".
  const parts = name.split(".");
  for (let i = 1; i < parts.length; i++) {
    const extension = parts.slice(i).join(".");
    const icon = (light && map.light.extensions[extension]) || map.extensions[extension] || map.languages[extension];
    if (icon) return icon;
  }
  return map.file;
}

export function folderIcon(map: IconMap, path: string, open: boolean, light = false): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const table = open ? map.foldersOpen : map.folders;
  const lightTable = open ? map.light.foldersOpen : map.light.folders;
  return (light && lightTable[name]) || table[name] || (open ? map.folderOpen : map.folder);
}
