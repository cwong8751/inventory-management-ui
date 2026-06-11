# inventory ui
A lightweight inventory management system based off of barcodes. 


## Barcode structure
An average barcode will look like this: 

```
ABCDM01
```

It has 7 digits, and is a unique identifier for each piece of clothing. 

```
ABC
```

is the prefix, containing: 

<pre>A</pre>
The type of clothing. 

<pre>B</pre>
The style of clothing. 

<pre>C</pre>
Texture of clothing. 

<pre>D</pre>
Is a mandatory separator marker that is never read, but just as a separator. 

<pre>M</pre>
Is the size denominator, it can range from XS, S, M, L, XL, 2XL and so on. 

<pre>01</pre>
The trailing number stands for the number of clothing it is, for this particular size of this particular clothing. <em>Note: this number is ranged from 01-99. </em>

<b>Valid barcodes: </b> BBKDM12, LLCDXL93, AACDS12

## Lookup table
Below the table converts the common prefix codes <pre>ABC</pre> into human readable formats. 

<em>The table is not ready yet</em>

## Image upload
A image only gets uploaded when an item with a unique prefix is first uploaded. 

For example: 

```
ABCDS01
```

will prompt a image upload, but 

```
ABCDS02 or ABCDM01
```
will not. 

## Project structure 

```inventory-ui``` contains front-end structure, powered by React. 

To run: 

```
cd inventory-ui

npm install

npm run dev
```

```server``` contains the backend structure, powered by Express and multer. 

To run: 

```
cd server

npm install 

node index.js
```

