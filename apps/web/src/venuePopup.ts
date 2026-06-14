import type { ResultVenue } from "@meetup/core";
import { photoUrl } from "./api";
import { formatDuration, formatPriceLevel, formatRating, formatRatingCount } from "./format";

/** Escape a string for safe interpolation into popup HTML attributes and text. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the inner HTML for a venue's map popup. Kept as a pure string builder so
 * it can be unit tested and handed straight to Leaflet's `bindPopup`. All
 * caller supplied text is escaped to keep the markup safe.
 */
export function venuePopupHtml(venue: ResultVenue, rank?: number): string {
  const name = escapeHtml(venue.name);

  const photo = venue.photoRef
    ? `<div class="map-popup__photo"><img src="${escapeHtml(
        photoUrl(venue.photoRef, 320),
      )}" alt="${name}" loading="lazy" /></div>`
    : "";

  const rankBadge =
    rank !== undefined ? `<span class="map-popup__rank">${escapeHtml(String(rank))}</span>` : "";

  const metaParts: string[] = [];
  if (venue.rating !== undefined && Number.isFinite(venue.rating)) {
    const count = formatRatingCount(venue.ratingCount);
    const countLabel = count ? ` <span class="map-popup__count">(${escapeHtml(count)})</span>` : "";
    metaParts.push(
      `<span class="map-popup__rating"><span aria-hidden="true">★</span> ${escapeHtml(
        formatRating(venue.rating),
      )}${countLabel}</span>`,
    );
  }
  const price = formatPriceLevel(venue.priceLevel);
  if (price) {
    metaParts.push(`<span class="map-popup__price">${escapeHtml(price)}</span>`);
  }
  const meta =
    metaParts.length > 0 ? `<div class="map-popup__meta">${metaParts.join("")}</div>` : "";

  const trip = `<div class="map-popup__trip">Longest trip <strong>${escapeHtml(
    formatDuration(venue.maxSeconds),
  )}</strong></div>`;

  const directions = venue.googleMapsUri
    ? `<a class="map-popup__link" href="${escapeHtml(
        venue.googleMapsUri,
      )}" target="_blank" rel="noreferrer">Directions</a>`
    : "";

  return (
    `<div class="map-popup">` +
    photo +
    `<div class="map-popup__body">` +
    `<div class="map-popup__head">${rankBadge}<h3 class="map-popup__name">${name}</h3></div>` +
    meta +
    trip +
    directions +
    `</div></div>`
  );
}
