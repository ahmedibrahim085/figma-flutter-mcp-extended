// imageSize reads the size an image file declares and returns undefined for anything it cannot read: other formats, and files cut off
// before the size. The progressive JPEG is built here by hand (a SOF2 segment after an APP0 segment); the baseline JPEG and the PNG
// are fixtures: 1_34.png is the real Figma PNG, 1_34.jpg is made from it with `sips -s format jpeg`. Both are 468 x 792.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {imageSize} from '../src/utils/image-size.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/screenshots/${name}`, import.meta.url));
const PNG = fixture('1_34.png');
const JPG = fixture('1_34.jpg');

/** SOI, an APP0 segment (length 16) the walker must skip, then one SOF segment of the given marker declaring 200 wide x 300 high. */
const jpegWith = (sofMarker: number) => Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14),
    Buffer.from([0xff, sofMarker, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x00, 0xc8, 0x01, 0x01, 0x11, 0x00]),
]);

test('a PNG and a baseline JPEG give their size', () => {
    assert.deepEqual(imageSize(PNG), {width: 468, height: 792});
    assert.deepEqual(imageSize(JPG), {width: 468, height: 792});
});

test('a progressive JPEG (SOF2) gives its size after an APP0 segment', () => {
    assert.deepEqual(imageSize(jpegWith(0xc2)), {width: 200, height: 300});
    assert.deepEqual(imageSize(jpegWith(0xc0)), {width: 200, height: 300});
});

test('a PNG cut off before its size gives undefined, whatever the cut', () => {
    for (const length of [0, 4, 8, 10, 16, 23]) assert.equal(imageSize(PNG.subarray(0, length)), undefined, `${length} bytes`);
    assert.deepEqual(imageSize(PNG.subarray(0, 24)), {width: 468, height: 792});
});

test('a JPEG cut off before its size gives undefined, whatever the cut', () => {
    const whole = jpegWith(0xc2);
    for (const length of [0, 2, 6, 20, 24, whole.length - 5]) assert.equal(imageSize(whole.subarray(0, length)), undefined, `${length} bytes`);
    assert.equal(imageSize(JPG.subarray(0, 100)), undefined);
});

test('other bytes give undefined', () => {
    assert.equal(imageSize(Buffer.from('<svg/>')), undefined);
    assert.equal(imageSize(Buffer.from('%PDF-1.4')), undefined);
});
