import { homePage, loginPage, registerPage } from "../src/views";

describe("views", () => {
  it("escapes HTML in the prefilled email", () => {
    const html = loginPage({ email: `"><script>alert(1)</script>` });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("shows the error message when one is given", () => {
    const html = registerPage({ error: "Something failed." });

    expect(html).toContain(`<div class="error">Something failed.</div>`);
  });

  it("shows no error box when no error is given", () => {
    const html = loginPage();

    expect(html).not.toContain(`class="error"`);
  });

  it("links the login and register pages to each other", () => {
    expect(loginPage()).toContain(`href="/register"`);
    expect(registerPage()).toContain(`href="/login"`);
  });

  it("escapes the email on the home page", () => {
    const html = homePage("<b>x</b>@example.com");

    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;@example.com");
  });
});
