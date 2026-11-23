// Adds the Firebase file Android needs for phone notifications, when it's
// available. Everything else lives in app.json.
//   Local builds: put google-services.json in the project folder.
//   EAS builds:   upload it as a file environment variable named
//                 GOOGLE_SERVICES_JSON (it's kept out of git).
const fs = require('fs');

module.exports = ({ config }) => {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ??
    (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
