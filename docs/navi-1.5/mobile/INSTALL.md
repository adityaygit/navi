# Installing the Navi app on your phone

Navi is built automatically in the cloud each time the app changes. You download the newest build from GitHub and put it on your phone. No app store, no developer account and no fee.

You need to be signed in to GitHub with access to the `adityaygit/navi` repository.

## Find the newest build

1. Open https://github.com/adityaygit/navi and click **Actions** (top of the page).
2. On the left, click **Mobile app**.
3. Click the top run in the list that has a **green tick**. (A yellow circle means it is still building; a red cross means that build failed, so pick the next green one.)
4. Scroll to **Artifacts** at the bottom of the run page. There are two downloads:
   - **Navi-android**: for Android phones.
   - **Navi-ios**: for iPhone.

   Downloads are kept for 30 days. If a run is older, start a fresh build: on the **Mobile app** page click **Run workflow**, then **Run workflow** again, and wait about 10 to 15 minutes.

GitHub always delivers artifacts as a `.zip` file. Unzip it first; inside is `Navi.apk` (Android) or `Navi.ipa` (iPhone).

---

## Android

### First install

1. On the phone, open the GitHub run page in your browser (steps above) and tap **Navi-android** to download it. You can also download it on a computer and copy it to the phone.
2. Open the **Files** (or **My Files**) app, go to **Downloads**, and tap the zip to open it. Extract **Navi.apk**.
3. Tap **Navi.apk**.
4. Android asks whether to allow installs from this app (your browser or Files app). Tap **Settings**, turn on **Allow from this source**, then go back.
5. Tap **Install**. If Google Play Protect warns that the app is unknown, tap **More details** → **Install anyway**. (It warns because the app is not from the Play Store.)
6. Open **Navi**. Allow notifications and the microphone when it asks.

### Updates

Download the newer **Navi-android** the same way and tap **Navi.apk** → **Update**. It installs over the old one and keeps you signed in. Every build is signed with the same key, so updates always install on top.

If Android ever says "App not installed" or "conflicts with an existing package", uninstall Navi first (long-press the icon → **Uninstall**) and install again. You will have to sign in again.

---

## iPhone

Apple only lets apps from the App Store run on an iPhone, unless you sign the app yourself. You can do that for free with any Apple ID, using a program called **Sideloadly** on a Windows PC or a Mac. Your iPhone needs a USB cable to the computer the first time.

**Use a spare Apple ID if you can.** Sideloadly signs in to Apple with it to create a free signing certificate. Your main Apple ID works too, but a separate free one keeps things apart. Create one at https://account.apple.com if needed.

### 1. Set up the computer (once)

**Windows**
1. Sideloadly needs the versions of **iTunes** and **iCloud** that you download **from Apple's website**, not the Microsoft Store versions. If you installed either from the Microsoft Store, uninstall it first (Start → Settings → Apps → find iTunes / iCloud → Uninstall).
2. Install iTunes and iCloud using the download links on Sideloadly's page: https://sideloadly.io (look for "web version of iTunes & iCloud"). Restart the computer afterwards.
3. Download **Sideloadly for Windows** from https://sideloadly.io and install it.

**Mac**
1. Download **Sideloadly for macOS** from https://sideloadly.io, open the download, and drag Sideloadly into **Applications**.
2. Open it. If Sideloadly or macOS asks you to install or allow a helper (for example a Mail plug-in), follow its on-screen prompts and enter your Mac password.

Requirements change from time to time; https://sideloadly.io always lists the current ones.

### 2. Install Navi

1. Download **Navi-ios** from the GitHub run (see "Find the newest build") on the computer, and unzip it to get **Navi.ipa**.
2. Plug the iPhone into the computer with a cable and unlock it. If the iPhone asks **Trust This Computer?**, tap **Trust** and enter your passcode.
3. Open **Sideloadly**. Your iPhone appears in the **iDevice** box.
4. Drag **Navi.ipa** onto the big IPA icon at the top left of Sideloadly.
5. In **Apple account**, type your (spare) Apple ID email.
6. Click **Start**. Enter the Apple ID password when asked, and the 2-factor code if Apple sends one.
7. Wait until the bottom of the window says **Done**.

### 3. Allow it on the iPhone (first time only)

1. **Turn on Developer Mode** (iOS 16 and later): open **Settings → Privacy & Security**, scroll to the bottom, tap **Developer Mode**, turn it on and tap **Restart**. After the restart, tap **Turn On** and enter your passcode.
   (If you don't see Developer Mode, open the Navi icon once; iOS then shows the option.)
2. **Trust your Apple ID as a developer**: open **Settings → General → VPN & Device Management**. Under **Developer App**, tap your Apple ID email, then **Trust "your email"** → **Trust**.
3. Open **Navi**. Allow the microphone and notifications when it asks.

### 4. Every 7 days: refresh

With a free Apple ID, Apple makes the app stop opening **7 days after it was signed**. Your data is safe; it is stored on Navi's server and in the app, and stays when you refresh.

To refresh, do any one of these:

- **Re-install with Sideloadly:** plug in the iPhone and repeat "Install Navi" with the same `Navi.ipa` (or a newer one). It installs over the top and you stay signed in. You don't need to repeat the Developer Mode or Trust steps.
- **Automatic refresh in Sideloadly:** in Sideloadly's advanced options, turn on **automatic refresh** before clicking Start. The computer must be on, with Sideloadly running, and the iPhone on the same Wi-Fi; it then re-signs the app before it expires.
- **AltStore** (https://altstore.io) is another free tool that refreshes apps automatically in the background over Wi-Fi while AltServer runs on your computer.

Installing a newer Navi build also resets the 7 days.

### What a free Apple ID can't do

- **No pushed notifications from the server** on iPhone (Apple only allows those for paid developer accounts). Navi schedules its own **local** notifications on the phone instead, so the morning and evening briefings, reminders and "focus finished" still arrive. Messages that come in while the app is closed show up when you open it.
- At most **3 sideloaded apps** can be active at once per free Apple ID, and Apple limits how many new app IDs you create per week. Navi uses one.
- Haptics, the microphone and voice, the keyboard and offline capture all work normally.

---

## For the developer

- The app reads its server address and the Supabase project URL and public key from `mobile/.env.production` at build time. These are public client values (they also ship in the website), so no repository secrets or variables are needed.
- Android builds are signed with a **public debug key** committed at `mobile/android/app/navi-debug.keystore` (Android's standard debug passwords). That is only for sideloaded testing. A private release key is needed before any store release.
- The iPhone build is unsigned; Sideloadly signs it with the Apple ID you enter. A paid Apple Developer account would remove the 7-day limit and allow server push notifications.
