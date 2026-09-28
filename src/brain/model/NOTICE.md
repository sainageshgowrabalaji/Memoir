# Where the model's numbers come from

`memoir-words.json` is a shrunk copy of GloVe word vectors, made for Memoir.

- **GloVe 6B, 100 dimensions.** Jeffrey Pennington, Richard Socher and Christopher D. Manning, 2014, *GloVe: Global Vectors for Word Representation*. https://nlp.stanford.edu/projects/glove/ Released under the Open Data Commons Public Domain Dedication and License (PDDL) v1.0.
- **wink-embeddings-sg-100d 1.1.0**, the package the vectors were read from. https://github.com/winkjs/wink-embeddings-sg-100d

  Copyright (c) 2024 GRAYPE Systems Private Limited. Released under the MIT License.

  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions.

  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## How it was shrunk

1. The 40,000 most used English words, by the [wordfreq](https://github.com/rspeer/wordfreq) lists, plus a few everyday extras (Indian food, family words, apps). Stored most used first.
2. The average direction every word shares was taken out, then the 100 numbers per word were reduced to 64 (principal component analysis).
3. Each word's numbers were scaled to length 1 and stored as small whole numbers from -127 to 127.

The script is `scripts/distill-model.py`.
