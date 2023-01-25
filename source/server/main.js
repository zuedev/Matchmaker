import "dotenv/config";
import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { existsSync, mkdirSync } from "node:fs";
import config from "./config.js";

const database = {
  statistics: await dbInit("statistics"),
  profiles: await dbInit("profiles"),
  matches: await dbInit("matches"),
};

const app = express();
const port = 3000;

app.use(express.json());

app.use(async (request, result, next) => {
  // ignore hit if they ask nicely
  if (!request.headers["matchmaker-ignorehit"]) await incrementHits();

  next();
});

app.get("/", async (request, response) => {
  response.sendFile("html/landing.html", {
    root: dirname(fileURLToPath(import.meta.url)),
  });
});

app.get("/developer", async (request, response) => {
  response.sendFile("html/developer.html", {
    root: dirname(fileURLToPath(import.meta.url)),
  });
});

app.get("/api", (request, response) => {
  response.json({ message: "Hello from server!" });
});

app.get("/api/hits", async (request, response) => {
  const hits = (await dbGet(database.statistics, "hits")) || 0;
  response.json({ hits });
});

app.get("/api/profiles/count", async (request, response) => {
  // return stats on profiles
  const profiles = await dbGet(database.profiles);
  response.json({
    count: Object.keys(profiles).length,
  });
});

app.get("/api/profiles/:id", async (request, response) => {
  if (await authenticate(request)) {
    const profile = await dbGet(database.profiles, request.params.id);
    // does the profile exist?
    if (profile) {
      response.json(profile);
    } else {
      response.status(404).json({ error: 404, message: "Profile not found" });
    }
  } else {
    response.status(401).json({ error: 401, message: "Unauthorized" });
    return;
  }
});

app.put("/api/profiles/:id", async (request, response) => {
  if (await authenticate(request)) {
    const profile = await dbGet(database.profiles, request.params.id);
    // does the profile exist?
    if (profile) {
      response
        .status(409)
        .json({ error: 409, message: "Profile already exists" });
    } else {
      // check if the profile has all the required fields
      for (const key of config.profiles.requiredFields) {
        if (!request.body[key])
          return response.status(400).json({
            error: 400,
            message: `Missing required field: ${key}`,
          });
      }

      // now check if the profile has any fields that are not allowed
      for (const key in request.body) {
        if (
          !config.profiles.requiredFields.includes(key) &&
          !config.profiles.optionalFields.includes(key)
        )
          return response.status(400).json({
            error: 400,
            message: `Invalid field: ${key}`,
          });
      }

      await dbSet(database.profiles, request.params.id, request.body);

      response.json({
        message: "Profile created",
        profile: request.body,
      });
    }
  } else {
    response.status(401).json({ error: 401, message: "Unauthorized" });
    return;
  }
});

app.patch("/api/profiles/:id", async (request, response) => {
  if (await authenticate(request)) {
    const profile = await dbGet(database.profiles, request.params.id);
    // does the profile exist?
    if (profile) {
      // check if the profile has any fields that are not allowed
      for (const key in request.body) {
        if (
          !config.profiles.requiredFields.includes(key) &&
          !config.profiles.optionalFields.includes(key)
        )
          return response.status(400).json({
            error: 400,
            message: `Invalid field: ${key}`,
          });

        // update the profile
        profile[key] = request.body[key];
      }

      await dbSet(database.profiles, request.params.id, profile);
      response.json({ message: "Profile updated" });
    } else {
      response.status(404).json({ error: 404, message: "Profile not found" });
    }
  } else {
    response.status(401).json({ error: 401, message: "Unauthorized" });
    return;
  }
});

app.get("/api/profiles/:id/suggestions", async (request, response) => {
  if (await authenticate(request)) {
    const profile = await dbGet(database.profiles, request.params.id);
    // does the profile exist?
    if (profile) {
      const profiles = await dbGet(database.profiles);
      const suggestions = [];

      // loop through all the profiles, and find the ones that match the profile's preferences
      for (const key in profiles) {
        if (key === request.params.id) continue;

        // check if the profile matches the preferences
        if ((await profileConfidence(profile, profiles[key])) > 1) {
          suggestions.push(profiles[key]);
        }
      }

      // if no suggestions were found...
      if (suggestions.length === 0)
        return response.status(404).json({
          error: 404,
          message: "No suggestions found",
        });

      response.json({ suggestions });
    } else {
      response.status(404).json({ error: 404, message: "Profile not found" });
    }
  } else {
    response.status(401).json({ error: 401, message: "Unauthorized" });
    return;
  }
});

app.post("/api/developer/reset", async (request, response) => {
  if (await authenticate(request)) {
    for (const key in database) {
      await dbReset(database[key]);
    }
    response.json({ message: "Database reset" });
  } else {
    response.status(401).json({ error: 401, message: "Unauthorized" });
    return;
  }
});

// 404 catches
app.get("/api/*", (request, response) => {
  response.status(404).json({ error: 404, message: "API endpoint not found" });
});
app.get("/*", (request, response) => {
  response.status(404).send("404: Page not Found");
});

// start this sucka up
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});

async function dbInit(dbName = "unnamed") {
  // Create database folder if it doesn't exist
  if (!existsSync("database")) mkdirSync("database");

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const file = join(__dirname, `database/${dbName}.json`);
  const adapter = new JSONFile(file);
  const db = new Low(adapter);

  await db.read();

  if (!db.data) db.data = {};

  await db.write();

  return db;
}

async function dbGet(db, key) {
  if (!key) return db.data;

  return db.data[key];
}

async function dbSet(db, key, value) {
  // if value is an object, convert all sub-objects to JSON strings
  if (typeof value === "object") {
    for (const subKey in value) {
      if (typeof value[subKey] !== "string") {
        value[subKey] = JSON.stringify(value[subKey]);
      }
    }
  } else {
    // if value is still not a string, convert it to one
    if (typeof value !== "string") value = JSON.stringify(value);
  }

  db.data[key] = value;
  await db.write();
}

async function dbReset(db) {
  db.data = {};
  await db.write();
}

async function incrementHits() {
  const hits = (await dbGet(database.statistics, "hits")) || 0;
  await dbSet(database.statistics, "hits", Number(hits) + 1);
}

async function authenticate(request) {
  // assume the request is not authenticated
  let authenticated = false;

  // authenticate if the request includes our special shared secret
  if (request.headers["matchmaker-sharedsecret"] === process.env.SHARED_SECRET)
    authenticated = true;

  // or if we are asked to skip authentication
  if (process.env.SKIP_AUTHENTICATION === "true") authenticated = true;

  return authenticated;
}

async function profileConfidence(a, b) {
  let confidence = 0;

  // do they have the same favorite color?
  if (
    a.favouriteColour &&
    b.favouriteColour &&
    a.favouriteColour === b.favouriteColour
  )
    confidence += 1;

  // do they have the same favorite food?
  if (a.favouriteFood && b.favouriteFood && a.favouriteFood === b.favouriteFood)
    confidence += 1;

  // how many words in their bios match? only do this for non-test profiles
  if (!a.name.startsWith("Test") || !b.name.startsWith("Test")) {
    const aBio = a.bio.toLowerCase().split(" ");
    const bBio = b.bio.toLowerCase().split(" ");
    for (const word of aBio) {
      if (bBio.includes(word)) confidence += 1;
    }
  }

  return confidence;
}
