# Watchlist

A small private watchlist for two people. The interface is hosted on GitHub Pages, while the catalog, member profiles, and watched status are protected by Firebase Authentication and Firestore Security Rules.

## Features

- Email and password login with no public registration
- Search and filters for media type, genre, minimum rating, and watched status
- Sorting by title or rating
- Live watched-status updates for both members
- Five random suggestions based on the active catalog filters
- IMDb, TMDb, and Google links

## Local development

Copy the Firebase web configuration into `firebase-config.js`, then serve the directory over HTTP:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. Add `localhost` to the Firebase Authentication authorized domains before signing in locally.

## Firebase setup

1. Create a Firebase project and a Firestore database in `europe-north2`.
2. Enable Email/Password Authentication and create the two users manually.
3. Add `dsnn.github.io` and `localhost` as authorized domains.
4. Create matching documents in `members/{uid}` and `watchState/{uid}`.
5. Deploy `firestore.rules` and run `npm test` against the Firestore Emulator before publishing changes.

The Firebase web configuration is intentionally public. Access is controlled by Authentication and `firestore.rules`; never commit service-account credentials or the private catalog.

## Deployment

The workflow in `.github/workflows/deploy-pages.yml` publishes only the static application files whenever `main` is pushed. Select **GitHub Actions** as the Pages source under **Settings → Pages**.
