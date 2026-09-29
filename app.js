import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const loginForm = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = document.querySelector("#login-button");
const resetPasswordButton = document.querySelector("#reset-password");
const authMessage = document.querySelector("#auth-message");
const appMessage = document.querySelector("#app-message");
const sessionName = document.querySelector("#session-name");
const logoutButton = document.querySelector("#logout-button");
const searchInput = document.querySelector("#search");
const mediaTypeSelect = document.querySelector("#media-type");
const genreSelect = document.querySelector("#genre");
const watchedFilterSelect = document.querySelector("#watched-filter");
const memberFilterOptions = [
  document.querySelector("#first-member-filter"),
  document.querySelector("#second-member-filter"),
];
const sortBySelect = document.querySelector("#sort-by");
const sortDirectionSelect = document.querySelector("#sort-direction");
const ratingInput = document.querySelector("#minimum-rating");
const ratingValue = document.querySelector("#rating-value");
const suggestButton = document.querySelector("#suggest-button");
const suggestionsPanel = document.querySelector("#suggestions");
const suggestionList = document.querySelector("#suggestion-list");
const suggestionEmpty = document.querySelector("#suggestion-empty");
const closeSuggestionsButton = document.querySelector("#close-suggestions");
const mediaList = document.querySelector("#media-list");
const summary = document.querySelector("#summary");
const emptyState = document.querySelector("#empty-state");

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = initializeFirestore(firebaseApp, { localCache: memoryLocalCache() });

let mediaItems = [];
let currentProfile = null;
let profiles = new Map();
let watchStates = new Map();
let unsubscribeListeners = [];
let statusUnsubscribes = [];
const pendingWrites = new Set();

const controls = [
  searchInput,
  mediaTypeSelect,
  genreSelect,
  watchedFilterSelect,
  sortBySelect,
  sortDirectionSelect,
  ratingInput,
  suggestButton,
];

function normalized(value) {
  return String(value ?? "").toLocaleLowerCase("sv-SE");
}

function showMessage(element, message, type = "") {
  element.textContent = message;
  element.dataset.type = type;
}

function genericAuthError() {
  showMessage(authMessage, "Inloggningen misslyckades. Kontrollera uppgifterna och försök igen.", "error");
}

function setControlsEnabled(enabled) {
  controls.forEach((control) => { control.disabled = !enabled; });
}

function textMatches(item, query) {
  const searchable = [item.title, item.year, ...(item.genres ?? [])].map(normalized).join(" ");
  return !query || searchable.includes(query);
}

function watchedAt(uid, mediaId) {
  return watchStates.get(uid)?.[mediaId] ?? null;
}

function timestampDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

function shortDate(value) {
  const date = timestampDate(value);
  if (!date) return "sett";
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" })
    .format(date)
    .replace(".", "");
}

function watchedButton(mediaItem, profile) {
  const timestamp = watchedAt(profile.uid, mediaItem.id);
  const isCurrentUser = profile.uid === auth.currentUser?.uid;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `watch-marker${timestamp ? " is-watched" : ""}`;
  button.textContent = timestamp
    ? `${profile.displayName} · ${shortDate(timestamp)}`
    : profile.displayName;
  button.setAttribute(
    "aria-label",
    `${profile.displayName}: ${timestamp ? "sedd" : "inte sedd"}${isCurrentUser ? ", klicka för att ändra" : ""}`,
  );
  button.setAttribute("aria-pressed", String(Boolean(timestamp)));

  if (!isCurrentUser) {
    button.disabled = true;
    button.classList.add("is-readonly");
  } else {
    const writeKey = `${profile.uid}:${mediaItem.id}`;
    button.disabled = pendingWrites.has(writeKey);
    button.addEventListener("click", () => toggleWatched(mediaItem.id));
  }

  return button;
}

function externalLink(mediaItem, label, href, className) {
  const link = document.createElement("a");
  link.className = className;
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  link.setAttribute("aria-label", `${label}: ${mediaItem.title}`);
  return link;
}

function itemRow(mediaItem) {
  const item = document.createElement("li");
  item.className = "movie";

  const details = document.createElement("div");
  details.className = "movie-details";
  const main = document.createElement("div");
  main.className = "movie-main";
  const title = document.createElement("span");
  title.className = "movie-title";
  title.textContent = mediaItem.title;
  main.append(title);

  if (mediaItem.genres?.length) {
    const genres = document.createElement("span");
    genres.className = "movie-genres";
    genres.textContent = mediaItem.genres.join(" · ");
    main.append(genres);
  }
  details.append(main);

  const metadata = document.createElement("div");
  metadata.className = "movie-metadata";
  if (mediaItem.year) {
    const year = document.createElement("span");
    year.className = "movie-year";
    year.textContent = mediaItem.year;
    metadata.append(year);
  }
  if (Number.isFinite(mediaItem.rating)) {
    const rating = document.createElement("span");
    rating.className = "movie-rating";
    rating.textContent = mediaItem.rating.toFixed(1);
    rating.title = "Betyg";
    metadata.append(rating);
  }
  if (mediaItem.imdbUrl) metadata.append(externalLink(mediaItem, "IMDb", mediaItem.imdbUrl, "imdb-link"));
  if (mediaItem.tmdbUrl) metadata.append(externalLink(mediaItem, "TMDb", mediaItem.tmdbUrl, "tmdb-link"));
  metadata.append(externalLink(
    mediaItem,
    "Google",
    `https://www.google.com/search?q=${encodeURIComponent(mediaItem.title)}`,
    "google-link",
  ));
  details.append(metadata);

  const markers = document.createElement("div");
  markers.className = "watch-markers";
  [...profiles.values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "sv-SE"))
    .forEach((profile) => markers.append(watchedButton(mediaItem, profile)));

  item.append(details, markers);
  return item;
}

function baseFilteredItems() {
  const query = normalized(searchInput.value.trim());
  const selectedType = mediaTypeSelect.value;
  const selectedGenre = genreSelect.value;
  const minimumRating = Number(ratingInput.value);

  return mediaItems.filter((item) => {
    const typeMatches = selectedType === "all" || item.type === selectedType;
    const genreMatches = selectedGenre === "all" || (item.genres ?? []).includes(selectedGenre);
    const ratingMatches = minimumRating === 0
      || (Number.isFinite(item.rating) && item.rating >= minimumRating);
    return typeMatches && genreMatches && ratingMatches && textMatches(item, query);
  });
}

function watchedMatches(item) {
  const memberProfiles = [...profiles.values()];
  const watchedCount = memberProfiles
    .filter((profile) => watchedAt(profile.uid, item.id))
    .length;

  switch (watchedFilterSelect.value) {
    case "all": return true;
    case "none": return watchedCount === 0;
    case "both": return memberProfiles.length >= 2 && watchedCount === memberProfiles.length;
    default: return Boolean(watchedAt(watchedFilterSelect.value, item.id));
  }
}

function sortedItems(items) {
  const direction = sortDirectionSelect.value === "desc" ? -1 : 1;
  return items.sort((a, b) => {
    if (sortBySelect.value === "rating") {
      const aHasRating = Number.isFinite(a.rating);
      const bHasRating = Number.isFinite(b.rating);
      if (aHasRating !== bHasRating) return aHasRating ? -1 : 1;
      if (aHasRating && a.rating !== b.rating) return (a.rating - b.rating) * direction;
    }
    return a.title.localeCompare(b.title, "sv-SE") * direction;
  });
}

function render() {
  const visibleItems = sortedItems(baseFilteredItems().filter(watchedMatches));
  const minimumRating = Number(ratingInput.value);
  mediaList.replaceChildren(...visibleItems.map(itemRow));
  emptyState.hidden = visibleItems.length !== 0;
  ratingValue.textContent = minimumRating === 0 ? "Alla" : minimumRating.toFixed(2);
  summary.textContent = mediaItems.length
    ? `${visibleItems.length} av ${mediaItems.length} titlar visas`
    : "Läser in titlar…";
}

function showSuggestions() {
  const candidates = [...baseFilteredItems()];
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [candidates[index], candidates[randomIndex]] = [candidates[randomIndex], candidates[index]];
  }
  const selectedItems = candidates.slice(0, 5);
  suggestionList.replaceChildren(...selectedItems.map(itemRow));
  suggestionEmpty.hidden = selectedItems.length !== 0;
  suggestionsPanel.hidden = false;
  suggestionsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeSuggestions() {
  suggestionsPanel.hidden = true;
}

function populateGenres() {
  const previous = genreSelect.value;
  const genres = [...new Set(mediaItems.flatMap((item) => item.genres ?? []))]
    .sort((a, b) => a.localeCompare(b, "sv-SE"));
  genreSelect.replaceChildren(new Option("Alla genrer", "all"));
  genres.forEach((genre) => genreSelect.append(new Option(genre, genre)));
  genreSelect.value = genres.includes(previous) ? previous : "all";
}

function updateProfileLabels() {
  sessionName.textContent = currentProfile?.displayName ?? "";
  const memberProfiles = [...profiles.values()]
    .sort((a, b) => {
      if (a.role === "owner" && b.role !== "owner") return -1;
      if (b.role === "owner" && a.role !== "owner") return 1;
      return a.displayName.localeCompare(b.displayName, "sv-SE");
    });
  memberFilterOptions.forEach((option, index) => {
    const profile = memberProfiles[index];
    option.hidden = !profile;
    option.disabled = !profile;
    option.value = profile?.uid ?? `member-${index + 1}`;
    option.textContent = profile ? `${profile.displayName} har sett` : "Medlem har sett";
  });
}

function stopDataListeners() {
  [...unsubscribeListeners, ...statusUnsubscribes].forEach((unsubscribe) => unsubscribe());
  unsubscribeListeners = [];
  statusUnsubscribes = [];
}

function listenToWatchStates() {
  statusUnsubscribes.forEach((unsubscribe) => unsubscribe());
  statusUnsubscribes = [];
  watchStates = new Map();
  profiles.forEach((profile) => {
    const unsubscribe = onSnapshot(
      doc(database, "watchState", profile.uid),
      (snapshot) => {
        watchStates.set(profile.uid, snapshot.exists() ? snapshot.data().watched ?? {} : {});
        render();
      },
      () => showMessage(appMessage, "Kunde inte läsa sett-status. Försök igen senare.", "error"),
    );
    statusUnsubscribes.push(unsubscribe);
  });
}

function startDataListeners() {
  stopDataListeners();
  setControlsEnabled(false);
  summary.textContent = "Läser in titlar…";

  unsubscribeListeners.push(onSnapshot(
    doc(database, "catalog", "current"),
    (snapshot) => {
      const items = snapshot.data()?.items;
      if (!snapshot.exists() || !Array.isArray(items)) {
        mediaItems = [];
        summary.textContent = "Katalogen är tom.";
        showMessage(appMessage, "Katalogen kunde inte läsas in.", "error");
        return;
      }
      mediaItems = items
        .filter((item) => item?.id && item?.title)
        .map((item) => ({ ...item, type: item.type ?? "movie" }));
      populateGenres();
      setControlsEnabled(true);
      showMessage(appMessage, "");
      render();
    },
    () => {
      setControlsEnabled(false);
      summary.textContent = "Kunde inte läsa in titlarna.";
      showMessage(appMessage, "Anslutningen till katalogen misslyckades.", "error");
    },
  ));

  unsubscribeListeners.push(onSnapshot(
    collection(database, "members"),
    (snapshot) => {
      profiles = new Map(snapshot.docs.map((member) => [member.id, { uid: member.id, ...member.data() }]));
      currentProfile = profiles.get(auth.currentUser?.uid) ?? currentProfile;
      updateProfileLabels();
      listenToWatchStates();
      render();
    },
    () => showMessage(appMessage, "Kunde inte läsa medlemsprofilerna.", "error"),
  ));
}

async function toggleWatched(mediaId) {
  const uid = auth.currentUser?.uid;
  if (!uid || !currentProfile) return;
  if (!navigator.onLine) {
    showMessage(appMessage, "Du är offline. Anslut till internet och försök igen.", "error");
    return;
  }

  const writeKey = `${uid}:${mediaId}`;
  if (pendingWrites.has(writeKey)) return;
  pendingWrites.add(writeKey);
  render();
  const reference = doc(database, "watchState", uid);

  try {
    if (watchedAt(uid, mediaId)) {
      await updateDoc(reference, { [`watched.${mediaId}`]: deleteField() });
    } else {
      await setDoc(reference, { watched: { [mediaId]: serverTimestamp() } }, { merge: true });
    }
    showMessage(appMessage, "");
  } catch (error) {
    console.error(error);
    showMessage(appMessage, "Ändringen kunde inte sparas. Försök igen.", "error");
  } finally {
    pendingWrites.delete(writeKey);
    render();
  }
}

async function showAuthenticatedUser(user) {
  try {
    const member = await getDoc(doc(database, "members", user.uid));
    if (!member.exists()) {
      await signOut(auth);
      genericAuthError();
      return;
    }
    currentProfile = { uid: member.id, ...member.data() };
    authView.hidden = true;
    appView.hidden = false;
    updateProfileLabels();
    startDataListeners();
  } catch (error) {
    console.error(error);
    await signOut(auth);
    genericAuthError();
  }
}

function showLoggedOut() {
  stopDataListeners();
  mediaItems = [];
  profiles = new Map();
  watchStates = new Map();
  currentProfile = null;
  pendingWrites.clear();
  mediaList.replaceChildren();
  suggestionList.replaceChildren();
  closeSuggestions();
  setControlsEnabled(false);
  appView.hidden = true;
  authView.hidden = false;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(authMessage, "");
  loginButton.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
    loginForm.reset();
  } catch (error) {
    console.error(error);
    genericAuthError();
  } finally {
    loginButton.disabled = false;
  }
});

resetPasswordButton.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!email) {
    showMessage(authMessage, "Fyll i din e-postadress först.", "error");
    emailInput.focus();
    return;
  }
  resetPasswordButton.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    showMessage(authMessage, "Om adressen hör till ett konto skickas ett återställningsmejl.", "success");
  } catch (error) {
    console.error(error);
    showMessage(authMessage, "Det gick inte att skicka återställningsmejlet. Försök igen.", "error");
  } finally {
    resetPasswordButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
    showMessage(appMessage, "Utloggningen misslyckades. Försök igen.", "error");
  } finally {
    logoutButton.disabled = false;
  }
});

[searchInput, mediaTypeSelect, genreSelect, ratingInput, watchedFilterSelect]
  .forEach((control) => control.addEventListener("input", () => {
    render();
    closeSuggestions();
  }));
[sortBySelect, sortDirectionSelect].forEach((control) => control.addEventListener("input", render));
suggestButton.addEventListener("click", showSuggestions);
closeSuggestionsButton.addEventListener("click", closeSuggestions);
window.addEventListener("offline", () => showMessage(appMessage, "Du är offline. Ändringar kan inte sparas.", "error"));
window.addEventListener("online", () => showMessage(appMessage, "Anslutningen är återställd.", "success"));

try {
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, (user) => {
    if (user) showAuthenticatedUser(user);
    else showLoggedOut();
  });
} catch (error) {
  console.error(error);
  genericAuthError();
}
