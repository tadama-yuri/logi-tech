const TEMPLATE_PATHS = {
  shell: './shared/templates/shell.html',
  login: './screens/templates/login.html',
  analytics: './screens/templates/analytics.html',
  entry: './screens/templates/entry.html',
  records: './screens/templates/records.html',
  admin: './screens/templates/admin.html'
};

export async function loadTemplates() {
  const entries = await Promise.all(Object.entries(TEMPLATE_PATHS).map(async ([name, path]) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTMLテンプレートを読み込めません: ${path}`);
    return [name, await response.text()];
  }));
  return Object.fromEntries(entries);
}

export function renderTemplate(templates, name, values) {
  return templates[name].replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key] ?? '');
}