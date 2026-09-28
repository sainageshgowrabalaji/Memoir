// Reading what a link is about from its page, with pages shaped like the real ones.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decodeEntities,
  fromInstagramEmbed,
  fromInstagramMeta,
  fromMeta,
  fromOEmbed,
  hashtagsOf,
  instagramEmbedUrl,
  pageHeadline,
  readMeta,
} from '../src/brain/pages';

const REEL_FOR_BOTS = `<!DOCTYPE html><html><head>
<title>nomadic.eats on Instagram: &quot;Best dosa in Jersey City&#x1f525;&quot;</title>
<meta property="og:title" content="nomadic.eats on Instagram: &quot;Best dosa in Jersey City&#x1f525; Saravana Bhavan, Newark Ave.&quot;" />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/t51.29350-15/123_n.jpg?stp=dst-jpg&amp;_nc_ht=x" />
<meta property="og:description" content="1,204 likes, 38 comments - nomadic.eats on March 3, 2024: &quot;Best dosa in Jersey City&#x1f525; Saravana Bhavan, Newark Ave.
Open 8am to 10pm. Try the ghee roast.
#dosa #jerseycity #vegetarian&quot;. " />
<meta property="og:url" content="https://www.instagram.com/nomadic.eats/reel/C4abcDEF/" />
</head><body></body></html>`;

const LOGIN_WALL = `<html><head><title>Instagram</title>
<meta property="og:title" content="Instagram" />
<meta property="og:description" content="Create an account or log in to Instagram - Share what you're into with the people who get you." />
</head></html>`;

const EMBED_PAGE = `<html><body><div class="Embed">
<div class="Header"><a class="Username"><span class="UsernameText">fit.with.ravi</span></a></div>
<img class="EmbeddedMediaImage" alt="Photo by Ravi" src="https://scontent.cdninstagram.com/v/embed_1.jpg?a=1&amp;b=2" srcset="x 640w">
<div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/fit.with.ravi/">fit.with.ravi</a> 3 stretches for a stiff back after sitting all day<br />1. Cat cow, 10 times<br/>2. Child&#039;s pose, 30 seconds<br>3. Hip flexor stretch <a href="/explore/tags/mobility/">#mobility</a><div class="CaptionComments"><a>View all 120 comments</a></div></div>
</div></body></html>`;

test('Instagram links become their embed page', () => {
  assert.equal(instagramEmbedUrl('https://www.instagram.com/reel/C4abcDEF/?igsh=MWx0'), 'https://www.instagram.com/reel/C4abcDEF/embed/captioned/');
  assert.equal(instagramEmbedUrl('https://instagram.com/reels/C4abcDEF'), 'https://www.instagram.com/reel/C4abcDEF/embed/captioned/');
  assert.equal(instagramEmbedUrl('https://www.instagram.com/nomadic.eats/p/Cx12/'), 'https://www.instagram.com/p/Cx12/embed/captioned/');
  assert.equal(instagramEmbedUrl('https://www.instagram.com/nomadic.eats/'), null);
});

test('a reel shown to link-preview bots gives its caption, author, date and picture', () => {
  const page = fromInstagramMeta(readMeta(REEL_FOR_BOTS))!;
  assert.equal(page.author, '@nomadic.eats');
  assert.equal(page.postedOn, 'March 3, 2024');
  assert.match(page.text, /^Best dosa in Jersey City🔥 Saravana Bhavan, Newark Ave\.\nOpen 8am to 10pm\. Try the ghee roast\.\n#dosa/);
  assert.ok(!page.text.endsWith('"'));
  assert.equal(page.image, 'https://scontent.cdninstagram.com/v/t51.29350-15/123_n.jpg?stp=dst-jpg&_nc_ht=x');
  assert.equal(pageHeadline(page), 'Best dosa in Jersey City🔥 Saravana Bhavan, Newark Ave.');
  assert.deepEqual(hashtagsOf(page.text), ['dosa', 'jerseycity', 'vegetarian']);
});

test('the login page is not mistaken for a reel', () => {
  assert.equal(fromInstagramMeta(readMeta(LOGIN_WALL)), null);
});

test('the embed page gives the caption line by line, without the comments', () => {
  const page = fromInstagramEmbed(EMBED_PAGE)!;
  assert.equal(page.author, '@fit.with.ravi');
  assert.equal(page.image, 'https://scontent.cdninstagram.com/v/embed_1.jpg?a=1&b=2');
  assert.equal(
    page.text,
    "3 stretches for a stiff back after sitting all day\n1. Cat cow, 10 times\n2. Child's pose, 30 seconds\n3. Hip flexor stretch #mobility",
  );
  assert.ok(!page.text.includes('View all'));
  assert.equal(pageHeadline(page), '3 stretches for a stiff back after sitting all day');
});

test('YouTube and TikTok answers', () => {
  const yt = fromOEmbed({ title: 'Spring Boot + Kafka in 20 minutes', author_name: 'Tech Primers', thumbnail_url: 'https://i.ytimg.com/vi/x/hq.jpg' })!;
  assert.equal(yt.title, 'Spring Boot + Kafka in 20 minutes');
  assert.equal(pageHeadline(yt), 'Spring Boot + Kafka in 20 minutes');
  const tt = fromOEmbed({ title: 'Easy paneer tikka at home #recipe', author_name: 'cookwithmeera' }, true)!;
  assert.equal(tt.text, 'Easy paneer tikka at home #recipe');
  assert.equal(tt.author, '@cookwithmeera');
  assert.equal(pageHeadline(tt), 'Easy paneer tikka at home');
  assert.equal(fromOEmbed({ error: 'not found' }), null);
});

test('any other page gives its preview tags or its title', () => {
  const page = fromMeta(
    readMeta(`<html><head><title>Ignored when og:title exists</title>
      <meta name="description" content="Plain description">
      <meta property="og:title" content="How index funds work">
      <meta property="og:description" content="A calm guide to investing for retirement.">
      <meta property="og:site_name" content="NerdWallet"></head></html>`),
  )!;
  assert.equal(page.title, 'How index funds work');
  assert.equal(page.text, 'A calm guide to investing for retirement.');
  assert.equal(page.author, 'NerdWallet');
  const bare = fromMeta(readMeta('<html><head><title>  Jersey City\n Parking Rules </title></head></html>'))!;
  assert.equal(bare.title, 'Jersey City Parking Rules');
  assert.equal(fromMeta(readMeta('<html><body>nothing</body></html>')), null);
});

test('long captions make a short headline that ends on a word', () => {
  const headline = pageHeadline({
    title: '',
    text: 'This is the one trick nobody tells you about saving money on groceries every single week, and it works in every city',
    author: '',
    image: null,
    postedOn: '',
  });
  assert.ok(headline.length <= 90);
  assert.ok(headline.endsWith('…'));
  assert.ok(!/\s…$/.test(headline));
  assert.equal(decodeEntities('Tom &amp; Jerry&#39;s &quot;show&quot; &#x2764;'), 'Tom & Jerry\'s "show" ❤');
});
