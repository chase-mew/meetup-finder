export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "no route";
  }
  if (seconds < 60) {
    return "under 1 min";
  }
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return "";
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatPriceLevel(level: number | null | undefined): string {
  if (level === null || level === undefined || level <= 0) {
    return "";
  }
  return "£".repeat(Math.min(4, level));
}

export function formatRating(rating: number | null | undefined): string {
  if (rating === null || rating === undefined || !Number.isFinite(rating)) {
    return "No rating";
  }
  return rating.toFixed(1);
}

export function formatRatingCount(count: number | null | undefined): string {
  if (!count || count <= 0) {
    return "";
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  }
  return String(count);
}
