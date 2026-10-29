#!/bin/sh
# «Арена» as its own app on the LG TV (tvapp/, ua.home.arena). Runs on pult-core as user pult (the TV's root SSH key
# /home/pult/.ssh/tv_key and the packer /home/pult/media/ipk.py live only there), from a checkout of this repo:
#   sh tools/tv-app.sh install     pack and put the app on the TV (again: files copied over, app closed to relaunch)
#   sh tools/tv-app.sh status      the version on the TV
# Same flow as the pult's domains/media/tvdev.sh: first time dev/install registers the app, then the files are copied
# straight into the app's directory (dev/install over an installed app leaves the old index.html). The game server
# itself (CT 106) never talks to the TV: this script is run from pult-core by claude-ops.
set -u
cd "$(dirname "$0")/.." || exit 1
H=${TVAPP_HOME:-/home/pult}; KEY=$H/.ssh/tv_key; PACK=${TVAPP_PACK:-$H/media/ipk.py}
ID=ua.home.arena; APP=$PWD/tvapp; DIR=/media/developer/apps/usr/palm/applications/$ID
TV=${TVAPP_TV:-$(python3 -c 'import json,sys
try: print(json.load(open("/etc/pult/site.json")).get("tvHost",""))
except Exception: print("")')}
tv() { ${TVAPP_SSH:-ssh} -i "$KEY" -o UserKnownHostsFile="$H/.ssh/known_hosts" -o BatchMode=yes -o ConnectTimeout=5 "root@$TV" "$@"; }
appver() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version",""))' "$APP/appinfo.json"; }
tv_ver() { tv "cat $DIR/appinfo.json 2>/dev/null" 2>/dev/null | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("version",""))
except Exception: print("")'; }
case "${1:-status}" in
status) v=$(tv_ver); [ -n "$v" ] && echo "«Арена» $v на ТБ" || echo "«Арени» на ТБ немає" ;;
install)
	[ -n "$TV" ] || { echo "немає tvHost (TVAPP_TV або /etc/pult/site.json)"; exit 1; }
	[ -f "$KEY" ] || { echo "немає ключа $KEY: запускати на pult-core як pult"; exit 1; }
	[ -f "$PACK" ] || { echo "немає $PACK (ipk.py з пульта)"; exit 1; }
	pkg=$(mktemp -t arena-XXXX.ipk)
	python3 "$PACK" "$APP" "$pkg" || { echo "ipk не зібрався"; exit 1; }
	tv true 2>/dev/null || { echo "ТБ не відповідає по SSH (увімкнений? SSH у Homebrew Channel?)"; exit 1; }
	if [ -z "$(tv_ver)" ]; then
		tv "cat > /tmp/$ID.ipk" < "$pkg" || { echo "ТБ не прийняв пакет"; exit 1; }
		tv "luna-send -w 90000 -n 8 luna://com.webos.appInstallService/dev/install '{\"id\":\"$ID\",\"ipkUrl\":\"/tmp/$ID.ipk\",\"subscribe\":true}'" >/dev/null 2>&1
		tv "rm -f /tmp/$ID.ipk" >/dev/null 2>&1
		i=0; while [ -z "$(tv_ver)" ]; do i=$((i+1)); [ "$i" -ge "${TVAPP_WAIT:-40}" ] && { echo "ТБ не встановив застосунок"; exit 1; }; sleep 1; done
	fi
	tar cz -C "$APP" . | tv "tar xz -C $DIR" || { echo "файли не скопіювались"; exit 1; }
	rm -f "$pkg"
	[ "$(tv_ver)" = "$(appver)" ] || { echo "на ТБ версія $(tv_ver), очікувалась $(appver)"; exit 1; }
	tv "luna-send -n 1 luna://com.webos.applicationManager/close '{\"id\":\"$ID\"}'" >/dev/null 2>&1
	echo "«Арена» $(appver) на ТБ: у списку застосунків LG, відкриває http://192.168.1.26/tv"
	;;
*) echo "tv-app.sh install|status"; exit 1 ;;
esac
