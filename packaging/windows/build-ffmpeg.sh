#!/usr/bin/env bash
set -euo pipefail
# Inputs are verified by build-windows-installer.ps1 before this script runs.
downloads=$(realpath "$1")
destination=$(realpath -m "$2")
work=$(mktemp -d /tmp/suno-ffmpeg-build-XXXXXXXX)
mkdir -p "$destination/bin" "$destination/licenses" "$destination/sources" "$work/prefix"
prefix="$work/prefix"
tar -xf "$downloads/llvm-mingw-20261006.tar.xz" -C "$work"
export PATH="$work/llvm-mingw-20261006-ucrt-ubuntu-22.04-x86_64/bin:$PATH"
target=x86_64-w64-mingw32
tar -xf "$downloads/lame-4.0.tar.gz" -C "$work"
cd "$work/lame-4.0"
./configure --host="$target" --build=x86_64-linux-gnu --prefix="$prefix" \
  --disable-shared --enable-static --disable-frontend --disable-decoder --disable-nasm > "$destination/lame-configure.log" 2>&1
make -j8 > "$destination/lame-build.log" 2>&1
make install > /dev/null
cp COPYING "$destination/licenses/LAME-COPYING.txt"
tar -xf "$downloads/zlib-1.3.2.tar.gz" -C "$work"
cd "$work/zlib-1.3.2"
make -f win32/Makefile.gcc PREFIX="$target-" -j8 libz.a > "$destination/zlib-build.log" 2>&1
cp libz.a "$prefix/lib/"
cp zlib.h zconf.h "$prefix/include/"
cp LICENSE "$destination/licenses/ZLIB-LICENSE.txt"
tar -xf "$downloads/ffmpeg-8.1.3.tar.xz" -C "$work"
cd "$work/ffmpeg-8.1.3"
./configure --target-os=mingw32 --arch=x86_64 --cross-prefix="$target-" \
  --prefix="$prefix" --disable-autodetect --disable-debug --disable-doc --disable-network \
  --disable-shared --enable-static --disable-x86asm --disable-everything \
  --enable-ffmpeg --enable-ffprobe --disable-ffplay --enable-avcodec --enable-avformat \
  --enable-avfilter --enable-swresample --enable-swscale --enable-libmp3lame --enable-zlib \
  --extra-cflags="-I$prefix/include" --extra-ldflags="-L$prefix/lib -static" \
  --enable-protocol=file,pipe \
  --enable-demuxer=matroska,mov,mp3,wav,ogg,flac,aac,image2,image2pipe,image_png_pipe,image_jpeg_pipe,image_webp_pipe \
  --enable-muxer=mp3,wav,image2 \
  --enable-decoder=aac,aac_fixed,alac,flac,mp3,mp3float,opus,vorbis,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,mjpeg,png,webp,vp8,bmp,gif \
  --enable-encoder=libmp3lame,pcm_s24le,pcm_s16le,mjpeg,png \
  --enable-parser=aac,flac,mpegaudio,opus,vorbis,vp8,png,mjpeg,webp \
  --enable-filter=silenceremove,afade,areverse,aformat,aresample,anull,format,scale \
  > "$destination/ffmpeg-configure.log" 2>&1
make -j8 ffmpeg.exe ffprobe.exe > "$destination/ffmpeg-build.log" 2>&1
cp ffmpeg.exe ffprobe.exe "$destination/bin/"
"$target-strip" "$destination/bin/ffmpeg.exe" "$destination/bin/ffprobe.exe"
cp COPYING.LGPLv2.1 LICENSE.md "$destination/licenses/"
cp ffbuild/config.log "$destination/ffmpeg-config.log"
cp "$downloads/ffmpeg-8.1.3.tar.xz" "$downloads/lame-4.0.tar.gz" "$downloads/zlib-1.3.2.tar.gz" "$destination/sources/"
cp "$0" "$destination/sources/build-ffmpeg.sh"
printf '%s\n' "$work" > "$destination/build-directory.txt"
echo "Built Windows x64 FFmpeg and ffprobe in $destination"
