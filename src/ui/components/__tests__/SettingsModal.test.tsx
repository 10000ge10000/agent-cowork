import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsModal } from "../SettingsModal";

describe("SettingsModal API connection test", () => {
  beforeEach(() => {
    vi.mocked(window.electron.getApiConfig).mockResolvedValue(null);
    vi.mocked(window.electron.testApiConnection).mockResolvedValue({
      success: true,
      message: "连接成功！",
    });
  });

  it("should test custom API settings through the Electron IPC bridge", async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText("自定义"));
    fireEvent.change(screen.getByPlaceholderText("https://your-api.com/v1"), {
      target: { value: "https://api.example.com/v1" },
    });
    fireEvent.change(screen.getByPlaceholderText("your-api-key"), {
      target: { value: "test-key" },
    });
    fireEvent.change(screen.getByPlaceholderText("model-name"), {
      target: { value: "claude-compatible-model" },
    });

    fireEvent.click(screen.getByRole("button", { name: "测试" }));

    await waitFor(() => {
      expect(window.electron.testApiConnection).toHaveBeenCalledWith({
        apiKey: "test-key",
        baseURL: "https://api.example.com/v1",
        model: "claude-compatible-model",
        apiType: "custom",
      });
    });
    expect(await screen.findByText("连接成功！")).toBeInTheDocument();
  });

  it("should allow NVIDIA users to test a custom model from the dropdown footer", async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await screen.findByText("API 配置");

    fireEvent.change(screen.getByPlaceholderText("nvapi-..."), {
      target: { value: "nvapi-test-key" },
    });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "__custom_nvidia_model__" },
    });
    fireEvent.change(screen.getByPlaceholderText("例如：provider/model-name"), {
      target: { value: "provider/free-custom-model" },
    });

    fireEvent.click(screen.getByRole("button", { name: "测试" }));

    await waitFor(() => {
      expect(window.electron.testApiConnection).toHaveBeenCalledWith({
        apiKey: "nvapi-test-key",
        baseURL: "https://integrate.api.nvidia.com/v1",
        model: "provider/free-custom-model",
        apiType: "nvidia",
      });
    });
  });
});
