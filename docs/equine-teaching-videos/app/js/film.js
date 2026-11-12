// The explainer film on the overview. Renders are not versioned and are absent
// from the static package, so the section appears only where the file answers.
const FILM = new URL('../../video/clinic-safety-rules/out/clinic-safety-rules-720p.mp4', import.meta.url);

try {
  const response = await fetch(FILM, { method: 'HEAD' });
  if (response.ok) {
    document.getElementById('film-video').src = FILM.href;
    document.getElementById('film').hidden = false;
  }
} catch {
  // No file or no server: the overview stays as it is without the film.
}
