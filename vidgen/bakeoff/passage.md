---
# The bake-off passage. `vidgen bakeoff` reads it twice per endpoint: once as written (the
# "raw" clip) and once through vidgen.toml's [pronunciations] merged with the dictionary
# below (the "dict" clip). Every cue word must appear in the narration; "Cue words aligned"
# in results.md counts the cues whose spoken tokens the alignment endpoint heard.
pronunciations:
  DNS: "D N S"
  TTL: "T T L"
  TLD: "T L D"
  nginx: "engine x"
  example.com: "example dot com"
  IPv6: "I P v six"
  93.184.216.34: "ninety three dot one eighty four dot two sixteen dot thirty four"
cues:
  - DNS
  - TTL
  - TLD
  - nginx
  - example.com
  - IPv6
  - 93.184.216.34
---
When you type example.com into a browser, the first thing that happens is not a web request
at all. It is a question for DNS, the system that turns names into addresses. Your laptop asks
a recursive resolver, usually run by your internet provider, and the resolver does the
legwork. If it has seen the name recently, it answers from its cache, and the record's TTL
tells it how many seconds that answer stays fresh. Otherwise it starts at the top. It asks a
root server which machines handle the com TLD, then asks one of those which name servers are
authoritative for example.com, and finally asks that server directly. The reply comes back as
an address record: 93.184.216.34 for the old internet, and a much longer IPv6 address for
networks that speak the newer protocol. The resolver caches both, again for as long as the TTL
allows, and hands the answer to your laptop. Only now does the browser open a connection.
On the other end, a web server such as nginx accepts it, reads the requested path, and sends
the page back. The whole lookup usually takes a few milliseconds, and most of the time you
never notice that DNS was involved at all.
