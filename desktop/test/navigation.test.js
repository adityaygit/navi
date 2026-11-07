const test = require("node:test");
const assert = require("node:assert");
const { classify, permissionAllowed } = require("../navigation");

const APP = "https://app.example.com";
const SB = "https://abc.supabase.co";

test("Navi's own pages stay in the window", () => {
  assert.equal(classify("https://app.example.com/tasks?tab=today", APP, SB), "app");
  assert.equal(classify("https://abc.supabase.co/auth/v1/verify?token=x", APP, SB), "app");
});

test("other sites open in the default browser", () => {
  assert.equal(classify("https://accounts.google.com/o/oauth2/auth", APP, SB), "external");
  assert.equal(classify("https://abc.supabase.co/rest/v1/tasks", APP, SB), "external");
  assert.equal(classify("https://evil.example.com/", APP, SB), "external");
  assert.equal(classify("mailto:hi@example.com", APP, SB), "external");
});

test("non-web schemes and plain http elsewhere are blocked", () => {
  assert.equal(classify("file:///etc/passwd", APP, SB), "block");
  assert.equal(classify("javascript:alert(1)", APP, SB), "block");
  assert.equal(classify("http://evil.example.com/", APP, SB), "block");
  assert.equal(classify("not a url", APP, SB), "block");
});

test("a local development server is allowed as the app", () => {
  assert.equal(classify("http://localhost:3000/", "http://localhost:3000", null), "app");
});

test("only Navi may use the microphone and notifications", () => {
  assert.equal(permissionAllowed("media", "https://app.example.com/", APP), true);
  assert.equal(permissionAllowed("notifications", "https://app.example.com/x", APP), true);
  assert.equal(permissionAllowed("media", "https://evil.example.com/", APP), false);
  assert.equal(permissionAllowed("geolocation", "https://app.example.com/", APP), false);
  assert.equal(permissionAllowed("media", "garbage", APP), false);
});
