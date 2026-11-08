// Electron patches `fs` to read files inside `app.asar`, so a binary archived in
// the asar satisfies existsSync and fs.access yet cannot be spawned. Only an
// unpacked copy is executable. Forge's asar unpack pattern covers `.node` and
// `.dll` but not `.exe`, so this is a live failure mode rather than a theoretical
// one: the packaged app resolves ffmpeg to a path that exists and then fails to
// run it.
export function isUnexecutableArchivePath(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  return candidate.split(/[\\/]+/).some((segment) => segment.endsWith('.asar'));
}
