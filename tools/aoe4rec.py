"""Minimal Age of Empires IV .rec replay reader (command log only).

Layout, per the community documentation of the format (aoe4world/replays-api, docs/replayData.bt):
  * header: u16 ?, u16 game build, "AOE4_REP", UTF-16 date string (64 bytes)
  * three Relic Chunky sections: FOLDPOST, DATASDSC, FOLDINFO (player list in its DATA:DATA child)
  * record stream: u32 type; 0 = game tick, 1 = chat / leave record
  * tick: u32 size, u8 version, u32 tick, u32 checksum, u32 block count, blocks of (u32 host, u32 ?, u32 size, payload)
  * payload: commands back to back, each prefixed with its own u16 length; type at byte 2, issuing player (1000 + id)
    at byte 20, a receiver list at byte 24 (the entity or group the order is addressed to), then (data type, data
    length, data) with the blueprint id (pbgid) at data[1:5] for train (0x03), research (0x10) and build (0x7B);
    build adds the placement position as 3 floats.

Cancels (identified from the stream itself; no public table of opcodes exists):
  * 0x05 cancel production: 34 bytes, addressed to the producing building, data = a small queue-item id. It follows
    batches of queued units within seconds and 93 % of its occurrences target a building that had just trained.
  * 0x38 cancel construction: no data, addressed to a freshly created building entity, typically followed by the same
    building being placed again.
A replay records *intentions*: the analyser nets cancelled orders out, but a placed building may still never finish.
"""
import gzip
import struct
from dataclasses import dataclass

TICKS_PER_SECOND = 8
KINDS = {0x03: 'train', 0x10: 'research', 0x7B: 'build', 0x05: 'cancel', 0x38: 'cancel_build'}
CANCELS = ('cancel', 'cancel_build')


@dataclass
class Player:
    slot: int
    name: str
    civ: str
    team: int
    pid: int


@dataclass
class Command:
    tick: int
    pid: int
    kind: str
    pbgid: int                 # 0 for cancels, which name no blueprint
    pos: tuple | None
    target: str = ''           # receiver list as hex: the building a train/research/cancel was addressed to

    @property
    def time(self):
        return self.tick / TICKS_PER_SECOND


def _node(b, o):
    typ = b[o:o + 4].decode('ascii', 'replace')
    cid = b[o + 4:o + 8].decode('ascii', 'replace')
    _ver, length, name_len = struct.unpack_from('<III', b, o + 8)
    start = o + 20 + name_len
    return typ, cid, start, start + length


def _players(b, start, end):
    (count,) = struct.unpack_from('<I', b, start + 10)
    out, o = [], start + 14
    while len(out) < count and o < end - 16:
        if b[o] in (0, 1):
            (n,) = struct.unpack_from('<I', b, o + 1)
            if 1 <= n <= 64:
                p = o + 5 + 2 * n
                if p + 13 <= end:
                    team, pid = struct.unpack_from('<II', b, p)
                    (cl,) = struct.unpack_from('<I', b, p + 9)
                    civ = b[p + 13:p + 13 + cl]
                    if team < 16 and 3 <= cl <= 40 and all(48 <= ch < 123 for ch in civ) and not civ.startswith(b'map_'):
                        out.append(Player(len(out), b[o + 5:p].decode('utf-16le', 'replace'), civ.decode(), team, pid))
                        o = p + 13 + cl
                        continue
        o += 1
    return out


def _receiver(c):
    """The receiver list after the 24-byte command header: (hex, offset of what follows it)."""
    o = 24
    if c[o] == 0x80:
        n = 2 + 4 * c[o + 1]
    elif c[o] & 0x40:
        n = 1 + 4 * (c[o] & 0x3F)
    else:
        n = 4
    return c[o:o + n].hex(), o + n


def _data(c):
    """Skip the command header and the receiver list; return the data bytes."""
    _, o = _receiver(c)
    if o >= len(c) or c[o] == 0xFF:
        return b''
    n, o = c[o + 1], o + 2
    if n == 0x80:
        n, o = c[o], o + 1
    return c[o:o + n]


def is_replay_bytes(b):
    return b[:2] == b'\x1f\x8b' or b[4:11] == b'AOE4_RE'


def load(path):
    return load_bytes(open(path, 'rb').read())


def load_bytes(b):
    if b[:2] == b'\x1f\x8b':
        b = gzip.decompress(b)
    if b[4:11] != b'AOE4_RE':
        raise ValueError('not an AoE4 replay')
    version = b[2] | (b[3] << 8)
    date = b[12:76].decode('utf-16le', 'replace').split('\x00', 1)[0]
    o = _node(b, 76 + 24)[3]          # FOLDPOST
    o = _node(b, o + 24)[3]           # DATASDSC
    typ, cid, s, e = _node(b, o)      # FOLDINFO
    if (typ, cid) != ('FOLD', 'INFO'):
        raise ValueError('FOLDINFO not found')
    players, p = [], s
    while p < e:
        ct, ci, cs, ce = _node(b, p)
        if (ct, ci) == ('DATA', 'DATA'):
            players = _players(b, cs, ce)
        p = ce

    cmds, o, last, total_cmds = [], e, 0, {}
    while o + 4 <= len(b):
        (kind,) = struct.unpack_from('<I', b, o)
        o += 4
        if kind == 0:
            (size,) = struct.unpack_from('<I', b, o)
            o += 4
            end = o + size
            _v, tick, _ck, nblk = struct.unpack_from('<BIII', b, o)
            q = o + 13
            last = tick
            for _ in range(nblk):
                _h, _u, bsz = struct.unpack_from('<III', b, q)
                q += 12
                pay, pp = b[q:q + bsz], 0
                q += bsz
                while pp + 2 <= len(pay):
                    (n,) = struct.unpack_from('<H', pay, pp)
                    if n < 2:
                        break
                    c = pay[pp:pp + n]
                    pp += n
                    if len(c) < 28:
                        continue
                    pid = struct.unpack_from('<I', c, 20)[0] - 1000
                    if 0 <= pid < 64 and c[2] != 0x99:  # ignore camera samples
                        total_cmds[pid] = total_cmds.get(pid, 0) + 1
                    k = KINDS.get(c[2])
                    if not k:
                        continue
                    target, _ = _receiver(c)
                    if k in CANCELS:
                        cmds.append(Command(tick, pid, k, 0, None, target))
                        continue
                    if len(c) < 35:
                        continue
                    d = _data(c)
                    if len(d) < 5:
                        continue
                    pos = None
                    if k == 'build' and len(d) >= 17:
                        x, _y, z = struct.unpack_from('<fff', d, 5)
                        pos = (round(x, 1), round(z, 1))
                    cmds.append(Command(tick, pid, k, struct.unpack_from('<I', d, 1)[0], pos, target))
            o = end
        elif kind == 1:
            size, _sub = struct.unpack_from('<II', b, o)
            o = o + 4 + size
        else:
            break
    return dict(version=version, date=date, players=players, commands=cmds, duration=last / TICKS_PER_SECOND, total_commands=total_cmds)
