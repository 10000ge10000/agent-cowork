/**
 * Vitest 测试环境全局设置
 *
 * 此文件在每个测试文件运行前自动加载，用于：
 * 1. 注册 @testing-library/jest-dom 自定义匹配器
 * 2. 配置全局测试环境
 * 3. Mock Electron API（渲染进程测试需要）
 */
import '@testing-library/jest-dom';

// Mock Electron API 用于前端组件测试
const mockElectronAPI = {
  sendEvent: vi.fn(),
  onServerEvent: vi.fn((_callback: (event: unknown) => void) => {
    // 返回清理函数
    return () => {};
  }),
  checkApiConfig: vi.fn().mockResolvedValue({ hasConfig: true }),
  getApiConfig: vi.fn().mockResolvedValue(null),
  saveApiConfig: vi.fn().mockResolvedValue(undefined),
  getPermissionConfig: vi.fn().mockResolvedValue({
    defaultMode: 'smart',
    toolOverrides: {},
    forceConfirmDangerous: true,
    enableLogging: true,
  }),
  savePermissionConfig: vi.fn().mockResolvedValue({ success: true }),
  getProxyStatus: vi.fn().mockResolvedValue({ running: false, config: null }),
  testApiConnection: vi.fn().mockResolvedValue({ success: true, message: 'OK' }),
  getRecentCwds: vi.fn().mockResolvedValue([]),
  selectDirectory: vi.fn().mockResolvedValue(null),
  getStaticData: vi.fn().mockResolvedValue({ version: '0.1.0' }),
  generateSessionTitle: vi.fn().mockResolvedValue('Test Session'),
};

// 注入到全局 window 对象
Object.defineProperty(window, 'electron', {
  value: mockElectronAPI,
  writable: true,
});

// 全局测试配置
beforeEach(() => {
  // 每个测试前重置 mock 状态
  vi.clearAllMocks();
});
