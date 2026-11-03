// Material Icon Theme icons (MIT, Philipp Kief) for files and folders, served
// from the same preview URL as the Monaco bundle.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { experimental_useCodeTheme } from "@get-bb/plugin-sdk/app";
import { fileIcon, folderIcon, type IconMap } from "@/lib/file-icons";
import { Icon } from "@/components/ui/icon";

const IconContext = createContext<{ map: IconMap; baseUrl: string } | null>(null);

let cached: Promise<IconMap> | null = null;

export function FileIconProvider({ baseUrl, children }: { baseUrl: string | null; children: ReactNode }) {
  const [map, setMap] = useState<IconMap | null>(null);
  useEffect(() => {
    if (baseUrl === null) return;
    cached ??= fetch(`${baseUrl}/file-icons/map.json`).then((response) => {
      if (!response.ok) throw new Error(`icon map: ${response.status}`);
      return response.json() as Promise<IconMap>;
    });
    cached.then(setMap, () => {
      cached = null;
    });
  }, [baseUrl]);
  return <IconContext.Provider value={map && baseUrl ? { map, baseUrl } : null}>{children}</IconContext.Provider>;
}

export function FileIcon({ path, folder, open, className = "size-4" }: { path: string; folder?: boolean; open?: boolean; className?: string }) {
  const context = useContext(IconContext);
  const { mode, theme } = experimental_useCodeTheme();
  if (context === null) return <Icon name={folder ? "Folder" : "File"} className={`${className} opacity-70`} />;
  const light = (theme?.type ?? mode) === "light";
  const name = folder ? folderIcon(context.map, path, open ?? false, light) : fileIcon(context.map, path, light);
  return <img src={`${context.baseUrl}/file-icons/${name}.svg`} alt="" draggable={false} className={`${className} shrink-0 select-none`} />;
}
