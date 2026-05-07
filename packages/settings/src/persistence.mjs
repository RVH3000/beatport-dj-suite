// Re-Exports aus @bpdjs/file-manager — Phase-4-Migration.
// Diese Datei behält Stabilität für externe Konsumenten, falls sie schon
// importieren; intern nutzt @bpdjs/settings nun direkt @bpdjs/file-manager.
export { writeJsonAtomic, readJsonOptional, fileExists } from "@bpdjs/file-manager";
