import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
export function pngPixels(buffer) {
  assert(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'REVIEW_PNG_SIGNATURE');
  let width,height,channels;const chunks=[];
  for(let offset=8;offset<buffer.length;) {
    const length=buffer.readUInt32BE(offset),type=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,offset+8+length);offset+=length+12;
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert(data[8]===8&&[2,6].includes(data[9])&&data[12]===0,'REVIEW_PNG_FORMAT');channels=data[9]===2?3:4;}
    if(type==='IDAT')chunks.push(data);
  }
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,pixels=Buffer.alloc(stride*height);
  assert(raw.length===(stride+1)*height,'REVIEW_PNG_LENGTH');
  const paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)];assert(filter<=4,'REVIEW_PNG_FILTER');
    for(let x=0;x<stride;x++) {const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;pixels[i]=(raw[y*(stride+1)+1+x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}
  }
  return {width,height,channels,pixels};
}
export function maskCoverage(buffer,rectangles) {
  const image=pngPixels(buffer);
  return rectangles.map(rect=>{
    const left=Math.ceil(rect.x+1),top=Math.ceil(rect.y+1),right=Math.floor(rect.x+rect.width-1),bottom=Math.floor(rect.y+rect.height-1);
    assert(left>=0&&top>=0&&right<=image.width&&bottom<=image.height&&right>left&&bottom>top,'REVIEW_MASK_RECT_BOUNDS');
    let count=0,total=0;
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const i=(y*image.width+x)*image.channels;total++;if(image.pixels[i]>=245&&image.pixels[i+1]<=10&&image.pixels[i+2]>=245)count++;}
    return {bounds:[left,top,right,bottom],pixels:total,masked:count,coverage:count/total};
  });
}
