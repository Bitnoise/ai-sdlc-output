function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           font-family: system-ui, sans-serif; background: #f3f4f6; color: #111827; }
    .card { width: 100%; max-width: 360px; margin: 16px; padding: 32px; background: #fff;
            border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.08); }
    h1 { margin: 0 0 24px; font-size: 24px; }
    label { display: block; margin-bottom: 16px; font-size: 14px; font-weight: 500; }
    input { display: block; width: 100%; margin-top: 6px; padding: 10px 12px; font-size: 16px;
            border: 1px solid #d1d5db; border-radius: 8px; }
    input:focus { outline: 2px solid #2563eb; border-color: transparent; }
    button { width: 100%; padding: 12px; font-size: 16px; font-weight: 600; color: #fff;
             background: #2563eb; border: 0; border-radius: 8px; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { margin-bottom: 16px; padding: 10px 12px; font-size: 14px; color: #991b1b;
             background: #fee2e2; border-radius: 8px; }
    .alt { margin-top: 20px; text-align: center; font-size: 14px; }
    a { color: #2563eb; }
  </style>
</head>
<body><main class="card">${body}</main></body>
</html>`;
}

interface FormOptions {
  error?: string;
  email?: string;
}

function authForm(opts: {
  title: string;
  action: string;
  button: string;
  passwordAutocomplete: string;
  alt: string;
} & FormOptions): string {
  const error = opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : "";
  return layout(
    opts.title,
    `<h1>${opts.title}</h1>
     ${error}
     <form method="post" action="${opts.action}">
       <label>Email
         <input type="email" name="email" required autocomplete="email"
                value="${escapeHtml(opts.email ?? "")}">
       </label>
       <label>Password
         <input type="password" name="password" required minlength="8"
                autocomplete="${opts.passwordAutocomplete}">
       </label>
       <button type="submit">${opts.button}</button>
     </form>
     <p class="alt">${opts.alt}</p>`,
  );
}

export function loginPage(opts: FormOptions = {}): string {
  return authForm({
    ...opts,
    title: "Log in",
    action: "/login",
    button: "Log in",
    passwordAutocomplete: "current-password",
    alt: `No account yet? <a href="/register">Create an account</a>`,
  });
}

export function registerPage(opts: FormOptions = {}): string {
  return authForm({
    ...opts,
    title: "Create an account",
    action: "/register",
    button: "Create account",
    passwordAutocomplete: "new-password",
    alt: `Already have an account? <a href="/login">Log in</a>`,
  });
}

export function homePage(email: string): string {
  return layout(
    "Welcome",
    `<h1>Welcome!</h1>
     <p>You are logged in as <strong>${escapeHtml(email)}</strong>.</p>
     <p>Welcome home!</p>
     <form method="post" action="/logout"><button type="submit">Log out</button></form>`,
  );
}
