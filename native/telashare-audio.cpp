//
// TelaShare - Compartilhamento de tela e áudio P2P
// Projeto original: https://github.com/JulianoMachadoS/telashare
// Copyright (C) 2026 Juliano Machado da Silva
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see https://www.gnu.org/licenses/.
//

// telashare-audio.exe — captura o som do Windows EXCETO o do TelaShare (#35)
// -----------------------------------------------------------------------------
// Usa a API de "process loopback" do Windows (Windows 10 2004 / build 19041 ou mais novo):
// captura tudo o que os outros programas tocam e deixa de fora o processo indicado e os
// processos filhos dele (o TelaShare inteiro: janela, áudio, GPU...). Assim, as vozes da chamada,
// que o próprio TelaShare toca, não voltam para dentro do áudio da tela compartilhada.
//
// Uso:  telashare-audio.exe <pid-do-TelaShare> [taxa=48000]
//       telashare-audio.exe --version
// Saída: PCM 16 bits, estéreo, intercalado, na taxa pedida, pela saída padrão (stdout).
// Mensagens (stderr, uma por linha): "READY <taxa> 2 s16" ou "ERROR <etapa> 0x<hresult>".
// Termina sozinho quando a entrada padrão (stdin) fecha, ou seja, quando o TelaShare fecha.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <io.h>
#include <fcntl.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#define HELPER_VERSION "1.0.0"

static volatile LONG g_stop = 0;

static void fail(const char* step, HRESULT hr) {
  fprintf(stderr, "ERROR %s 0x%08lx\n", step, (unsigned long)hr);
  fflush(stderr);
}

// Recebe o resultado da ativação assíncrona do dispositivo de áudio virtual
class ActivateHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
  LONG ref_ = 1;
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  IAudioClient* client = nullptr;

  ~ActivateHandler() { if (done) CloseHandle(done); }

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *ppv = static_cast<IAgileObject*>(this);
    } else {
      *ppv = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref_); }
  STDMETHODIMP_(ULONG) Release() override {
    LONG r = InterlockedDecrement(&ref_);
    if (r == 0) delete this;
    return r;
  }
  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    IUnknown* unk = nullptr;
    HRESULT hrActivate = E_FAIL;
    result = op->GetActivateResult(&hrActivate, &unk);
    if (SUCCEEDED(result)) result = hrActivate;
    if (SUCCEEDED(result) && unk) result = unk->QueryInterface(__uuidof(IAudioClient), (void**)&client);
    if (unk) unk->Release();
    SetEvent(done);
    return S_OK;
  }
};

// Quando o TelaShare fecha, a entrada padrão fecha junto: aí o auxiliar termina
static DWORD WINAPI watchStdin(LPVOID) {
  char buf[64];
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  DWORD n = 0;
  while (ReadFile(in, buf, sizeof(buf), &n, nullptr) && n > 0) {}
  InterlockedExchange(&g_stop, 1);
  return 0;
}

static bool writeAll(const void* data, size_t len) {
  const char* p = static_cast<const char*>(data);
  while (len > 0) {
    size_t w = fwrite(p, 1, len, stdout);
    if (w == 0) return false;
    p += w;
    len -= w;
  }
  return fflush(stdout) == 0;
}

int main(int argc, char** argv) {
  if (argc >= 2 && strcmp(argv[1], "--version") == 0) {
    printf("telashare-audio %s\n", HELPER_VERSION);
    return 0;
  }
  if (argc < 2) {
    fprintf(stderr, "uso: telashare-audio.exe <pid> [taxa]\n");
    return 2;
  }
  const DWORD pid = strtoul(argv[1], nullptr, 10);
  const DWORD rate = argc >= 3 ? strtoul(argv[2], nullptr, 10) : 48000;
  if (!pid || rate < 8000 || rate > 192000) {
    fprintf(stderr, "ERROR args 0x00000000\n");
    return 2;
  }
  _setmode(_fileno(stdout), _O_BINARY);

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) { fail("coinit", hr); return 1; }

  // 1) Ativa o dispositivo virtual de process loopback, EXCLUINDO o TelaShare (e filhos)
  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT pv = {};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ActivateHandler* handler = new ActivateHandler();
  IActivateAudioInterfaceAsyncOperation* op = nullptr;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, handler, &op);
  if (FAILED(hr)) { fail("activate", hr); handler->Release(); return 1; }
  if (WaitForSingleObject(handler->done, 10000) != WAIT_OBJECT_0) { fail("activate-timeout", E_FAIL); return 1; }
  if (op) op->Release();
  if (FAILED(handler->result) || !handler->client) { fail("activate-result", handler->result); handler->Release(); return 1; }
  IAudioClient* client = handler->client;
  handler->Release();

  // 2) Formato pedido: PCM 16 bits estéreo na taxa do app (o Windows converte sozinho)
  WAVEFORMATEX fmt = {};
  fmt.wFormatTag = WAVE_FORMAT_PCM;
  fmt.nChannels = 2;
  fmt.nSamplesPerSec = rate;
  fmt.wBitsPerSample = 16;
  fmt.nBlockAlign = static_cast<WORD>(fmt.nChannels * fmt.wBitsPerSample / 8);
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                          AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                          200000 /* 20 ms */, 0, &fmt, nullptr);
  if (FAILED(hr)) { fail("initialize", hr); client->Release(); return 1; }

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->SetEventHandle(ready);
  if (FAILED(hr)) { fail("event", hr); client->Release(); return 1; }

  IAudioCaptureClient* capture = nullptr;
  hr = client->GetService(__uuidof(IAudioCaptureClient), (void**)&capture);
  if (FAILED(hr)) { fail("service", hr); client->Release(); return 1; }

  hr = client->Start();
  if (FAILED(hr)) { fail("start", hr); capture->Release(); client->Release(); return 1; }

  CreateThread(nullptr, 0, watchStdin, nullptr, 0, nullptr);
  fprintf(stderr, "READY %lu 2 s16\n", (unsigned long)rate);
  fflush(stderr);

  // 3) Laço de captura: entrega cada pacote assim que chega
  std::vector<char> silence;
  int code = 0;
  while (!g_stop) {
    if (WaitForSingleObject(ready, 200) != WAIT_OBJECT_0) continue; // sem som tocando: sem pacotes
    UINT32 frames = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&frames)) && frames > 0) {
      BYTE* data = nullptr;
      DWORD flags = 0;
      hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) { fail("buffer", hr); code = 1; g_stop = 1; break; }
      const size_t bytes = (size_t)frames * fmt.nBlockAlign;
      bool ok;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        if (silence.size() < bytes) silence.assign(bytes, 0);
        ok = writeAll(silence.data(), bytes);
      } else {
        ok = writeAll(data, bytes);
      }
      capture->ReleaseBuffer(frames);
      if (!ok) { g_stop = 1; break; } // o TelaShare fechou a saída
    }
  }

  client->Stop();
  capture->Release();
  client->Release();
  CloseHandle(ready);
  CoUninitialize();
  return code;
}
