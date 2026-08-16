class Person {

    public string Name { get; set; }
    public int Age { get; set; }

    public void Greet(string target) {
        System.Console.WriteLine("Hello, " + target);
    }

    
}