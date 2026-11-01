import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {maskCoverage} from './png-mask.mjs';
function fixture(masked){const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);return b;};const header=Buffer.alloc(13);header.writeUInt32BE(8,0);header.writeUInt32BE(8,4);header[8]=8;header[9]=2;const raw=Buffer.alloc(8*25);for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=y*25+1+x*3;raw[i]=255;raw[i+1]=masked?0:255;raw[i+2]=255;}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
test('actual PNG pixels prove covered rectangles and reject displaced/outside masks',()=>{const rect={x:1,y:1,width:6,height:6};assert.equal(maskCoverage(fixture(true),[rect])[0].coverage,1);assert.equal(maskCoverage(fixture(false),[rect])[0].coverage,0);assert.throws(()=>maskCoverage(fixture(true),[{...rect,x:20}]),/REVIEW_MASK_RECT_BOUNDS/);});
