# 🏓 Pingpong Lessons

A small web app to track table tennis lesson purchases (10-hour packages) and lesson usage for two kids sharing one hour-balance pool. Runs as a static site on GitHub Pages, syncs across devices via Firebase (Firestore + Auth).

## Features
- Dashboard with remaining balance and per-child usage breakdown.
- Log a purchase (date, hours, notes).
- Log a lesson used (date, child, hours, notes).
- History with filters: date range, specific date (via same from/to), child, "Today only".
- Tap any history row to delete it.
- Offline-friendly (Firestore persists writes and syncs on reconnect).
- One shared family account — phone + laptop both see the same data.

## One-time setup

### 1. Create a Firebase project
1. Go to https://console.firebase.google.com → **Add project** → name it (e.g. `pingpong-lessons`). Skip Analytics.
2. Open **Authentication**. In the new console the left rail is minimal — click the 🔍 search icon and type `Authentication`, or go directly to `https://console.firebase.google.com/project/<your-project-id>/authentication`. Click **Get started** → **Sign-in method** → enable **Email/Password**.
3. **Authentication → Users → Add user** — create one shared account (e.g. `family@yourdomain.com` + password). Everyone in the family uses this same credential. Copy the UID shown in the table.
4. Open **Firestore Database** (same trick: 🔍 search for `Firestore`, or `https://console.firebase.google.com/project/<your-project-id>/firestore`). Click **Create database** → **production mode**, pick a region close to you.
5. **Firestore → Rules tab** — paste the following, replace `FAMILY_UID`, and **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null
                            && request.auth.uid == "FAMILY_UID";
       }
     }
   }
   ```

6. **Project Settings (gear icon) → General → Your apps** → click the **Web** (`</>`) icon → register an app (nickname `pingpong-web`). **Do NOT enable Firebase Hosting.** Firebase will show you a `firebaseConfig` object — copy those values into [`firebase-config.js`](./firebase-config.js).

### 2. (After deploying) Authorize your domain
In **Authentication → Settings → Authorized domains**, add `<your-github-username>.github.io` so sign-in works from the live site.

## Run locally (optional)
Because `app.js` uses ES module imports, open it through a local server, not `file://`:

```sh
cd /Users/baodongliu/work/pingpong
python3 -m http.server 8080
# then open http://localhost:8080
```

You also need to add `localhost` to Firebase **Authorized domains** (it's there by default).

## Deploy to GitHub Pages
```sh
cd /Users/baodongliu/work/pingpong
git init
git branch -M main
git add .
git commit -m "initial commit"

# create repo on github.com (e.g. "pingpong"), then:
git remote add origin git@github.com:<your-username>/pingpong.git
git push -u origin main
```

In the GitHub repo → **Settings → Pages** → Source: **Deploy from a branch**, Branch: `main`, Folder: `/ (root)`. Save. About a minute later the site is live at `https://<your-username>.github.io/pingpong/`.

## Security note
The values in `firebase-config.js` are not secrets — they identify the Firebase project, not authenticate it. Firestore security rules are what actually protect your data. It's fine for this file to be in a public repo. ([Firebase docs.](https://firebase.google.com/docs/projects/api-keys))

## Data model
Two Firestore collections.

**`purchases/{id}`** — `date` (`YYYY-MM-DD`), `hours` (number), `notes` (string), `createdAt` (Timestamp).

**`usages/{id}`** — `date` (`YYYY-MM-DD`), `hours` (number), `child` (`"son"` | `"daughter"`), `notes` (string), `createdAt` (Timestamp).

Balance is computed client-side as `sum(purchases.hours) − sum(usages.hours)` — no stored total means no drift.
