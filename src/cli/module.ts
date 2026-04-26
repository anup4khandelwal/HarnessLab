import { getModuleBySlug, moduleCatalog } from "./module-registry";
import { printModuleResult } from "./format";

const slug = Bun.argv[2];

if (slug === undefined) {
  console.log("Usage: bun run module <name>");
  console.log("Available modules:");
  for (const entry of moduleCatalog) {
    console.log(`- ${entry.slug}: ${entry.title}`);
  }
  process.exit(1);
}

const selected = getModuleBySlug(slug);

if (selected === undefined) {
  console.error(`Unknown module: ${slug}`);
  process.exit(1);
}

const result = await selected.run();
printModuleResult(selected.slug, result);

