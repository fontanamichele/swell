/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#ifndef mozilla_SwellDefines_h
#define mozilla_SwellDefines_h

#include "mozilla/CmdLineAndEnvUtils.h"

namespace mozilla {
namespace swell {
constexpr static const char* kRequiredArguments[] = {"url"};
#ifdef XP_WIN
#  define ATTEMPTING_DEELEVATION_FLAG "attempting-deelevation"
constexpr static const char* kOptionalArguments[] = {
    ATTEMPTING_DEELEVATION_FLAG};
#else
constexpr static auto kOptionalArguments = nullptr;
#endif
}  // namespace swell

template <typename CharT>
inline void EnsureSwellCommandlineSafe(int aArgc, CharT** aArgv) {
  mozilla::EnsureCommandlineSafe(aArgc, aArgv, swell::kRequiredArguments,
                                 swell::kOptionalArguments);
}
}  // namespace mozilla

#endif
