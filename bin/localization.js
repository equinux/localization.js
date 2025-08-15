#!/usr/bin/env node

/*eslint no-console:0 */
"use strict";

const babel = require("@babel/core");
const globSync = require("glob").sync;
const i18nStringsFiles = require("i18n-strings-files");
const https = require("https");
const fs = require("fs");
const path = require("path");
const commandLineArgs = require("command-line-args");

const options = commandLineArgs([
  { name: "command", defaultOption: true },
  { name: "base-url", type: String },
  { name: "file-pattern", type: String, defaultValue: "src/**/*.js" },
  { name: "pid", type: String },
  { name: "loc-version", type: String, defaultValue: "1.0" },
  { name: "group", type: String },
  { name: "language", type: String, multiple: true },
  { name: "upload-language", type: String, defaultValue: "en" },
  { name: "output-path", type: String, defaultValue: "src/translations" },
  { name: "fail-empty", type: Boolean, defaultValue: false },
  { name: "module-source-name", type: String, multiple: true },
  { name: "babel-preset", type: String, multiple: true },
  { name: "babel-plugin", type: String, multiple: true },
]);

if (!options["base-url"]) {
  throw new Error("Missing base URL");
}

if (!options.pid) {
  throw new Error("Missing PID");
}

if (!options.pid) {
  throw new Error("Missing group");
}

if (!options.language) {
  throw new Error("Missing language");
}

const FILE_PATTERN = options["file-pattern"];
const OUTPUT_DIR = options["output-path"];
const APP_PID = options.pid;
const LOC_VERSION = options["loc-version"];
const LOC_GROUP = options.group;
const LANGUAGE_CODE = options["upload-language"];
const UPLOAD_URL = `${options["base-url"]}/uploadStrings.php?pid=${APP_PID}&version=${LOC_VERSION}&groupID=${LOC_GROUP}&language=${LANGUAGE_CODE}`;
const DOWNLOAD_URL = `${options["base-url"]}/getStrings.php?pid=${APP_PID}&version=${LOC_VERSION}&group=${LOC_GROUP}`;
const LANGUAGES = options.language;
const FAIL_EMPTY = options["fail-empty"];
const BABEL_PRESETS = options["babel-preset"];
const BABEL_PLUGINS = options["babel-plugin"];
const MODULE_SOURCE_NAMES = options["module-source-name"] ?? ["formatjs"];

console.dir(
  {
    FILE_PATTERN,
    OUTPUT_DIR,
    APP_PID,
    LOC_VERSION,
    LOC_GROUP,
    LANGUAGE_CODE,
    UPLOAD_URL,
    DOWNLOAD_URL,
    LANGUAGES,
    ALLOW_EMPTY: FAIL_EMPTY,
    MODULE_SOURCE_NAMES,
    BABEL_PRESETS,
    BABEL_PLUGINS,
  },
  { colors: true },
);
console.log("\n");

const args = process.argv;
if (args.length < 3) {
  throw new Error("Invalid usage!");
}

const action = args[2];
if (action === "upload") {
  doUpload();
} else if (action === "download") {
  doDownload();
}

function doUpload() {
  console.log(`Extracting messages from ${FILE_PATTERN}…`);

  // extract messages
  const messages = globSync(FILE_PATTERN)
    .map((path) =>
      MODULE_SOURCE_NAMES.map((moduleSourceName) => {
        let messages;
        const plugins = BABEL_PLUGINS.map((plugin) =>
          plugin === "formatjs"
            ? [
                "formatjs",
                {
                  onMsgExtracted: (_, msg) => (messages = msg),
                },
              ]
            : plugin,
        );

        babel.transformFileSync(path, {
          presets: BABEL_PRESETS,
          plugins: plugins,
        });

        return messages;
      }).flat(),
    )
    .reduce((collection, descriptors) => {
      descriptors.forEach((descriptor) => {
        const id = descriptor.id;
        const defaultMessage = descriptor.defaultMessage;

        if (
          typeof descriptor.description === "object" &&
          typeof descriptor.description.skipUpload === "boolean" &&
          descriptor.description.skipUpload
        ) {
          return;
        }

        let description = "";
        if (typeof descriptor.description === "string") {
          description = descriptor.description;
        } else if (
          typeof descriptor.description === "object" &&
          typeof descriptor.description.comment === "string"
        ) {
          description = descriptor.description.comment;
        }

        if (collection.has(id)) {
          const otherDescriptor = collection.get(id);

          if (defaultMessage !== otherDescriptor.defaultMessage) {
            throw new Error(
              `Duplicate message id "${id}", but the \`defaultMessage\` are different: "${defaultMessage}" != "${otherDescriptor.defaultMessage}".`,
            );
          }

          if (description !== otherDescriptor.description) {
            throw new Error(
              `Duplicate message id "${id}", but the \`description\` are different: "${description}" != "${otherDescriptor.description}".`,
            );
          }
        }

        collection.set(id, { defaultMessage, description });
      });

      return collection;
    }, new Map());

  console.log(`Found ${messages.size} messages.`);

  // build localization data
  const data = {};

  messages.forEach((val, key) => {
    const text = val.defaultMessage;
    const comment = val.description || " ";

    data[key] = { text, comment };
  });

  // compile strings
  const strings = i18nStringsFiles.compile(data, {
    encoding: "utf8",
    wantsComments: true,
  });

  // upload
  const uploadUrl = new URL(UPLOAD_URL);

  const body =
    "file=BEGIN\n" + new Buffer(strings).toString("base64") + "\nEND";

  const upload = https.request(
    {
      host: uploadUrl.hostname,
      port: uploadUrl.port,
      path: uploadUrl.pathname + uploadUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      rejectUnauthorized: false,
    },
    function (res) {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        console.log("Changes: ");
        console.dir(chunk.split("<br><br>").slice(1), { colors: true });
      });
      res.on("end", () => {
        console.log("Upload complete.");
      });
    },
  );

  // post the data
  upload.write(body);
  upload.end();
}

function doDownload() {
  LANGUAGES.forEach(doDownloadLanguage);
}

async function doDownloadLanguage(language) {
  const downloadUrl = new URL(DOWNLOAD_URL + "&lang=" + language);

  console.log(`Loading translations for ${language}…`);

  https.get(
    {
      host: downloadUrl.hostname,
      port: downloadUrl.port,
      path: downloadUrl.pathname + downloadUrl.search,
      rejectUnauthorized: false,
    },
    function (res) {
      var chunks = new String();

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        chunks += chunk;
      });

      res.on("end", () => {
        const messages = i18nStringsFiles.parse(chunks, {
          encoding: "utf8",
          wantsComments: true,
        });
        const keys = Object.keys(messages);
        if (FAIL_EMPTY && keys.length === 0) {
          console.error("Error: No localization keys found");
          process.exit(1);
        }
        const data = keys.reduce((collection, key) => {
          const message = messages[key];

          collection[key] = message.text;

          return collection;
        }, {});

        const outputPath = path.format({
          dir: OUTPUT_DIR,
          name: language,
          ext: ".json",
        });

        fs.writeFile(outputPath, JSON.stringify(data, null, 4), function (err) {
          if (err) {
            console.error(err);
          } else {
            console.log(`Written ${keys.length} messages to ${outputPath}.`);
          }
        });
      });
    },
  );
}
