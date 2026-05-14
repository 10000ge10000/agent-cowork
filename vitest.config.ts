import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    // 测试环境配置
    environment: 'jsdom',

    // 启用全局测试 API（describe, it, expect 等）
    globals: true,

    // 全局测试设置文件
    setupFiles: ['./src/test/setup.ts'],

    // 测试文件匹配模式
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],

    // 排除目录
    exclude: ['node_modules', 'dist-react', 'dist-electron'],

    // 覆盖率配置
    coverage: {
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        'src/electron/main.ts',
      ],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },

    // 测试超时时间
    testTimeout: 10000,

    // 线程配置（Vitest 4+ 顶级选项）
    threads: true,
    minThreads: 1,
    maxThreads: 4,
  },
});