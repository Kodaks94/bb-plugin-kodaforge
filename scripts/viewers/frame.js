// Runs inside the sandboxed frame (see viewerPage in lib/preview.ts): ask the editor for
// the file's bytes, render them, and keep links from navigating the frame.
export function serve(render) {
  addEventListener("message", async (event) => {
    if (event.source !== parent || !(event.data?.bytes instanceof ArrayBuffer)) return;
    try {
      await render(event.data.bytes, document.getElementById("root"));
      parent.postMessage({ kodaforge: "rendered" }, "*");
    } catch (error) {
      parent.postMessage({ kodaforge: "failed", message: error?.message ?? String(error) }, "*");
    }
  });
  addEventListener(
    "click",
    (event) => {
      const link = event.target.closest?.("a");
      if (link && !(link.getAttribute("href") ?? "").startsWith("#")) event.preventDefault();
    },
    true,
  );
  parent.postMessage({ kodaforge: "ready" }, "*");
}
