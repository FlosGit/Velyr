# Generates the reel voiceover (edge-tts, free) + word-level timings for karaoke captions.
#   python make-vo.py
# Output: vo.mp3 + words.json ([{word, start, end} in seconds])
import asyncio, json, edge_tts

TEXT = ("My website was leaking sales, and I couldn't see where. "
        "So I gave an AI my code. "
        "Every Monday it finds the biggest leak and sends me the fix. "
        "I reply YES - it ships. "
        "Numbers drop? One YES rolls it back.")
VOICE = "en-US-AndrewNeural"
RATE = "+14%"

async def main():
    tts = edge_tts.Communicate(TEXT, VOICE, rate=RATE, boundary="WordBoundary")
    words = []
    with open("vo.mp3", "wb") as f:
        async for chunk in tts.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({
                    "word": chunk["text"],
                    "start": chunk["offset"] / 10_000_000,
                    "end": (chunk["offset"] + chunk["duration"]) / 10_000_000,
                })
    with open("words.json", "w") as f:
        json.dump(words, f, indent=1)
    print(f"{len(words)} words, last ends at {words[-1]['end']:.2f}s")

asyncio.run(main())
