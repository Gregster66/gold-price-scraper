export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request, env, ctx) {
    const gqlUrl =
      "https://www.proaurum.de/graphql?query=query%20productDetail(%24urlKey%3AString)%7Bproducts(filter%3A%7Burl_key%3A%7Beq%3A%24urlKey%7D%7D)%7Bitems%7B__typename%20categories%7Bid%20uid%20breadcrumbs%7Bcategory_id%20category_uid%20__typename%7D__typename%7Ddescription%7Bhtml%20__typename%7Did%20uid%20media_gallery_entries%7Bid%20label%20position%20disabled%20file%20__typename%7Dmeta_title%20meta_keyword%20meta_description%20name%20price%7BregularPrice%7Bamount%7Bcurrency%20value%20__typename%7D__typename%7D__typename%7Dsku%20small_image%7Burl%20__typename%7Durl_key%20country_of_manufacture%20bidAskPrice%7Bask_price_excl_tax%7Bcurrency%20value%20__typename%7Dask_price%7Bcurrency%20value%20__typename%7Dbid_price%7Bcurrency%20value%20__typename%7Davailable_for_ask%20available_for_bid%20__typename%7Dpm_available_for_customer_depot_tax%20pm_bar_number%20pm_category%20pm_condition%20pm_deliverytime%20pm_disable_for_home_delivery%20pm_dutyfree%20pm_fineness%20pm_is_mass_unit%20pm_metal_type_label%20pm_metal_type%20pm_metal_underlying%20pm_metal_underlying_label%20pm_packaging%20pm_producer%20pm_purity%20pm_shape_label%20pm_shape%20pm_shape_label%20pm_size%20pm_weight_fine%20special_offer_text%20special_from_date%20special_to_date%20ask_price_discount_absolute%20price_discount_absolute%20salable_sources%7Bcode%20pickupOnly%20pickuplocation%7Bname%20__typename%7DproductIsAvailableInSource%20__typename%7D...on%20PhysicalProductInterface%7Bweight%20__typename%7D...on%20ConfigurableProduct%7Bconfigurable_options%7Battribute_code%20attribute_id%20id%20label%20values%7Bdefault_label%20label%20store_label%20use_default_value%20value_index%20swatch_data%7B...on%20ImageSwatchData%7Bthumbnail%20__typename%7Dvalue%20__typename%7D__typename%7D__typename%7Dvariants%7Battributes%7Bcode%20value_index%20__typename%7Dproduct%7Bid%20media_gallery_entries%7Bid%20disabled%20file%20label%20position%20__typename%7Dsku%20stock_status%20price%7BregularPrice%7Bamount%7Bcurrency%20value%20__typename%7D__typename%7D__typename%7D__typename%7D__typename%7D__typename%7D%7D__typename%7D%7D&operationName=productDetail&variables=%7B%22urlKey%22%3A%221-unze-gold-maple-leaf%22%7D";

    // 1) Fetch prices
    const res = await fetch(gqlUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        Referer: "https://www.proaurum.de/shop/1-unze-gold-maple-leaf/",
        "User-Agent": "Mozilla/5.0 (compatible; gold-price-scraper/1.0)",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.log("GraphQL fetch failed:", res.status, res.statusText, body.slice(0, 500));
      return new Response("GraphQL fetch failed - check logs", { status: 502 });
    }

    const data = await res.json();
    if (data?.errors?.length) {
      console.log("GraphQL returned errors:", data.errors);
      return Response.json({ ok: false, errors: data.errors }, { status: 502 });
    }

    const item = data?.data?.products?.items?.[0];
    const bidAsk = item?.bidAskPrice;

    const buyPrice = bidAsk?.ask_price?.value;
    const sellPrice = bidAsk?.bid_price?.value;

    if (typeof buyPrice !== "number" || typeof sellPrice !== "number") {
      console.log("Missing buy/sell in response:", { bidAsk });
      return Response.json(
        { ok: false, message: "Buy/sell price missing in GraphQL response", bidAsk },
        { status: 500 }
      );
    }

    // 2) Build row fields you requested
    const ts = new Date().toISOString();
    const source = "proaurum-munich";

    // 3) Insert into D1
    // Requires wrangler.toml binding: [[d1_databases]] binding = "DB"
    const insert = await env.DB.prepare(
      `INSERT INTO proaurum_prices (ts, source, buy_price, sell_price)
       VALUES (?, ?, ?, ?)`
    )
      .bind(ts, source, buyPrice, sellPrice)
      .run();

    console.log("Saved price row:", { ts, source, buyPrice, sellPrice, insert });

    return Response.json({
      ok: true,
      saved: {
        ts,
        source,
        buy_price: buyPrice,
        sell_price: sellPrice,
      },
      d1: insert,
    });
  },
  async scheduled(event, env, ctx) {
    // Run your scrape+insert function here
    ctx.waitUntil(scrapeAndStore(env));
  }
};
