import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-no-project",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: await readFile("firestore.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "members", "owner-user"), { displayName: "Owner", role: "owner" }),
      setDoc(doc(database, "members", "member-user"), { displayName: "Member", role: "member" }),
      setDoc(doc(database, "catalog", "current"), { schemaVersion: 1, items: [] }),
      setDoc(doc(database, "watchState", "owner-user"), { watched: {} }),
      setDoc(doc(database, "watchState", "member-user"), { watched: {} }),
    ]);
  });
});

after(async () => environment?.cleanup());

test("unauthenticated users cannot read private data", async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(database, "catalog", "current")));
  await assertFails(getDoc(doc(database, "members", "owner-user")));
  await assertFails(getDoc(doc(database, "watchState", "member-user")));
});

test("authenticated non-members cannot read private data", async () => {
  const database = environment.authenticatedContext("outsider").firestore();
  await assertFails(getDoc(doc(database, "catalog", "current")));
  await assertFails(getDoc(doc(database, "watchState", "owner-user")));
  await assertFails(setDoc(doc(database, "watchState", "outsider"), { watched: {} }));
});

for (const uid of ["owner-user", "member-user"]) {
  test(`${uid} can read the catalog, profiles and both watch states`, async () => {
    const database = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(database, "catalog", "current")));
    await assertSucceeds(getDoc(doc(database, "members", "owner-user")));
    await assertSucceeds(getDoc(doc(database, "members", "member-user")));
    await assertSucceeds(getDoc(doc(database, "watchState", "owner-user")));
    await assertSucceeds(getDoc(doc(database, "watchState", "member-user")));
  });

  test(`${uid} can update only their own watch state`, async () => {
    const otherUid = uid === "owner-user" ? "member-user" : "owner-user";
    const database = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(updateDoc(doc(database, "watchState", uid), {
      "watched.tmdb_movie_42": new Date(),
    }));
    await assertFails(updateDoc(doc(database, "watchState", otherUid), {
      "watched.tmdb_movie_42": new Date(),
    }));
    await assertSucceeds(deleteDoc(doc(database, "watchState", uid)));
    await assertFails(deleteDoc(doc(database, "watchState", otherUid)));
    await assertSucceeds(setDoc(doc(database, "watchState", uid), { watched: {} }));
  });
}

test("watch state rejects additional top-level fields", async () => {
  const database = environment.authenticatedContext("owner-user").firestore();
  await assertFails(setDoc(doc(database, "watchState", "owner-user"), {
    watched: {},
    role: "owner",
  }));
});

test("clients cannot write catalog or member profiles", async () => {
  const database = environment.authenticatedContext("owner-user").firestore();
  await assertFails(setDoc(doc(database, "catalog", "current"), { items: [] }));
  await assertFails(updateDoc(doc(database, "members", "owner-user"), { role: "admin" }));
});

test("unknown paths are denied", async () => {
  const database = environment.authenticatedContext("owner-user").firestore();
  await assertFails(getDoc(doc(database, "private", "anything")));
  await assertFails(setDoc(doc(database, "private", "anything"), { value: true }));
});
