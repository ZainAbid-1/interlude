# Interlude: Google Play Console answers

Everything to paste into Play Console. Keep artist names, album covers and other brands **out** of the title, icon, screenshots and text.

## Main store listing

**App name** (30 max)
> Interlude: Guess the Song

**Short description** (80 max)
> Hear 3 seconds. Name the song first. Challenge friends in a real-time music duel.

**Full description**
> Think you know your music? Prove it.
>
> Interlude is a real-time, head-to-head music guessing game. Pick an artist you love, challenge a friend, and race through 10 rounds. Each round plays a 3-second clip: name the song from four options before the clock runs out. The faster you answer, the more you score.
>
> HOW IT WORKS
> • Pick an artist and Interlude builds a 10-song match.
> • Challenge a friend with one tap. They get a notification and join instantly, or share a 6-letter room code.
> • You both hear the same clip at the same moment. Name it first.
> • Ten rounds later, see who won and how your rating moved.
>
> FAIR, SKILL-BASED RANKING
> Interlude uses an Elo rating, the system behind chess rankings. Beat a stronger player and you climb fast; lose to a weaker one and you drop. No grinding, just skill.
>
> MORE
> • Leaderboards for every artist, with friends or everyone
> • Head-to-head records and rivalries with each friend
> • Reconnects automatically if your connection drops
> • Free, with no ads
>
> Every song you hear links back to Spotify and Apple Music so you can listen to the full track.
>
> Interlude is an independent fan-made game. It is not affiliated with, endorsed or sponsored by any artist, record label, Spotify, Apple or Deezer. Song information comes from Spotify; previews are streamed from iTunes and Deezer. All music belongs to its owners.

**Category:** Games → Trivia (or Music)
**Tags:** Music trivia, Multiplayer
**Contact email:** Zainabid7272@gmail.com
**Privacy policy:** https://github.com/ZainAbid-1/interlude/blob/main/docs/privacy-policy.md

**Graphics**
- App icon: 512×512 PNG (the music-note question mark)
- Feature graphic: 1024×500 (logo + wordmark on dark, no album art)
- Phone screenshots: 2–8. Use screens without recognisable album covers (home, create room, leaderboard rating, friends, settings), or blur covers.

## App content

**Privacy policy:** URL above.

**Ads:** No, the app does not contain ads.

**App access:** All features need sign-in with Google. Give reviewers a test Google account (Play Console → App access → "All or some functionality is restricted" → add the login and say "Sign in with Google using this account").

**Content rating questionnaire:** Category: Game. Answer **No** to violence, sexuality, language, controlled substances, gambling. Users can interact: **Yes** (players see each other's names and photos; no free chat). Shares location: No. Digital purchases: No. Expected rating: Everyone / PEGI 3 (or 12 if "users interact" raises it).

**Target audience:** 13+ (13–15, 16–17, 18+). Not designed for children.

**News app:** No. **Government app:** No. **Financial features:** None. **Health:** No.

**Account deletion:** Yes, users can create accounts.
- Delete account URL: https://github.com/ZainAbid-1/interlude/blob/main/docs/delete-account.md
- In-app path: Settings → Delete account

## Data safety form

**Does your app collect or share any of the required user data types?** Yes.
**Is all user data encrypted in transit?** Yes.
**Do you provide a way for users to request that their data is deleted?** Yes.

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Personal info → Name | Yes | No | Required | Account management, App functionality |
| Personal info → Email address | Yes | No | Required | Account management |
| Personal info → User IDs | Yes | No | Required | Account management, App functionality |
| Photos and videos → Photos (Google profile photo URL) | Yes | No | Required | App functionality |
| App activity → Other user-generated content (username, friends, answers) | Yes | No | Required | App functionality |
| App activity → In-app actions (matches, scores) | Yes | No | Required | App functionality |
| Device or other IDs (push notification token) | Yes | No | Optional | App functionality |

Not collected: location, financial info, health, messages, contacts, calendar, files, audio, web browsing, advertising ID, crash/diagnostics.
"Shared" means given to a third party for its own use. Service providers that process data on your behalf (Supabase, Google sign-in, Expo/Firebase notifications) **don't count as sharing**, so answer No.

## Release checklist

1. Run `supabase/account_deletion.sql` in Supabase.
2. Build: `npx eas-cli build --platform android --profile production` (an .aab).
3. Play Console → Testing → Closed testing → upload the .aab, add at least 12 testers, run for 14 days (if Play asks for it).
4. Complete the store listing and app content above.
5. Apply for production access → Production → Create release.
