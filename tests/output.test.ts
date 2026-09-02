import assert from 'node:assert/strict'
import test from 'node:test'
import { TailOutputReader } from '../src/output.ts'

test('tail reader exposes complete output below the cap', () => {
  const reader = new TailOutputReader(64)
  reader.append('hello ')
  reader.append('world')
  assert.deepEqual(reader.readFrom(0), {
    text: 'hello world',
    nextOffset: 11,
    lossy: false,
  })
})

test('tail reader marks an old offset lossy after trimming', () => {
  const reader = new TailOutputReader(5, () => '/workspace/.dsh-spill/full.log')
  reader.append('abcdefgh')
  assert.deepEqual(reader.readFrom(0), {
    text: 'defgh',
    nextOffset: 8,
    lossy: true,
    spillPath: '/workspace/.dsh-spill/full.log',
  })
  assert.deepEqual(reader.readFrom(6), {
    text: 'gh',
    nextOffset: 8,
    lossy: false,
    spillPath: '/workspace/.dsh-spill/full.log',
  })
})

test('tail trimming never starts on a UTF-8 continuation byte', () => {
  const reader = new TailOutputReader(5)
  reader.append(Buffer.from('A€BC', 'utf8'))
  const read = reader.readFrom(0)
  assert.equal(read.lossy, true)
  assert.equal(read.text.includes('\uFFFD'), false)
  assert.equal(read.text, '€BC')
})
