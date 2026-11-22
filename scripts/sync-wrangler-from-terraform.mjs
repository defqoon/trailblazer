#!/usr/bin/env node
// Copies Terraform outputs (D1 id, Access AUD, team domain) into wrangler.toml.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const out = JSON.parse(
  execFileSync("terraform", ["-chdir=infra/terraform", "output", "-json"], { encoding: "utf8" }),
);
const get = (k) => {
  const v = out[k]?.value;
  if (!v) throw new Error(`terraform output "${k}" is missing. Run terraform apply first.`);
  return v;
};

let toml = readFileSync("wrangler.toml", "utf8");
const set = (re, value, label) => {
  if (!re.test(toml)) throw new Error(`could not find ${label} in wrangler.toml`);
  toml = toml.replace(re, (_m, pre, post) => `${pre}"${value}"${post}`);
};
set(/^(database_id = )"[^"]*"(.*)$/m, get("d1_database_id"), "database_id");
set(/^(ACCESS_AUD = )"[^"]*"(.*)$/m, get("access_aud"), "ACCESS_AUD");
set(/^(ACCESS_TEAM_DOMAIN = )"[^"]*"(.*)$/m, get("access_team_domain"), "ACCESS_TEAM_DOMAIN");
writeFileSync("wrangler.toml", toml);
console.log("wrangler.toml updated from terraform outputs");
