import { homePage } from "../src/views";

describe("views", () => {
  it("shows the welcome message on the home page", () => {
    const html = homePage();

    expect(html).toContain("<h1>Welcome!</h1>");
    expect(html).toContain("Sign in to your account to get started");
    expect(html).toContain('<input type="email"');
    expect(html).toContain('<input type="password"');
    expect(html).toContain("<button type=\"submit\">Sign In</button>");
  });
});
