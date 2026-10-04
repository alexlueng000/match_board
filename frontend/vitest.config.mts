import { defineConfig } from 'vitest/config';
export default defineConfig({test:{environment:'jsdom',include:['tests/**/*.test.tsx'],clearMocks:true},oxc:{jsx:{runtime:'automatic'}}});
