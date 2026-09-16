import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("../OUT/index.html");
const target = resolve("../OUT/ScaleScope.html");
const packageDirectory = resolve("../OUT/ScaleScope");
const packageTarget = resolve(packageDirectory, "ScaleScope.html");
const readmeSource = resolve("distribution/README.txt");
const readmeTarget = resolve(packageDirectory, "README.txt");
const html = await readFile(source, "utf8");
const externalAssets = [
  ...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["'](?!data:|#)([^"']+)["']/gi),
];

if (externalAssets.length > 0) {
  throw new Error(
    `Сборка содержит внешние ресурсы: ${externalAssets.map((match) => match[1]).join(", ")}`,
  );
}

await mkdir(packageDirectory, { recursive: true });
await Promise.all([
  copyFile(source, target),
  copyFile(source, packageTarget),
  copyFile(readmeSource, readmeTarget),
]);
await rm(source);
console.log(`Готово: ${target}`);
console.log(`Папка для передачи: ${packageDirectory}`);
