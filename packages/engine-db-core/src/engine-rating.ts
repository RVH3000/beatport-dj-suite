// Engine DJ stores rating as 0, 10, 20, ..., 50 (0–5 in 10-unit steps).
// 0 = no rating, 50 = 5 stars.
export function engineRatingToStars(rating: number | null | undefined): number {
    return Math.max(0, Math.min(5, Math.round((rating || 0) / 10)));
}
