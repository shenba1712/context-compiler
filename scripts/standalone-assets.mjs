import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";

function assertRegularTree(directory, label) {
  if (!existsSync(directory)) {
    throw new Error(`Missing ${label}: ${directory}`);
  }

  const files = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const entryPath = join(path, entry.name);
      const stat = lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`${label} contains a symbolic link: ${entryPath}`);
      }
      if (stat.isDirectory()) visit(entryPath);
      else if (stat.isFile()) files.push(entryPath);
    }
  };
  visit(directory);

  if (files.length === 0) {
    throw new Error(`${label} contains no files: ${directory}`);
  }
  return files;
}

export function findStandaloneServer(webDir) {
  return [
    join(webDir, ".next/standalone/apps/web/server.js"),
    join(webDir, ".next/standalone/server.js"),
  ].find((path) => existsSync(path));
}

export function copyStandaloneAssets(webDir, server = findStandaloneServer(webDir)) {
  if (!server) {
    throw new Error(`Missing Next standalone server under ${join(webDir, ".next/standalone")}`);
  }

  const serverDir = dirname(server);
  const assets = [
    {
      source: join(webDir, ".next/static"),
      destination: join(serverDir, ".next/static"),
      label: "Next static assets",
    },
    {
      source: join(webDir, "public/samples"),
      destination: join(serverDir, "public/samples"),
      label: "public samples",
    },
  ];

  for (const { source, destination, label } of assets) {
    const sourceFiles = assertRegularTree(source, `source ${label}`);
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, dereference: true, force: true });
    const copiedFiles = assertRegularTree(destination, `standalone ${label}`);
    if (copiedFiles.length !== sourceFiles.length) {
      throw new Error(
        `Incomplete ${label} copy: expected ${sourceFiles.length} files, copied ${copiedFiles.length}`,
      );
    }
  }

  return relative(webDir, serverDir) || ".";
}

if (process.argv.includes("--copy")) {
  const webDir = join(process.cwd(), "apps/web");
  const destination = copyStandaloneAssets(webDir);
  console.log(`Validated standalone assets under apps/web/${destination}`);
}
