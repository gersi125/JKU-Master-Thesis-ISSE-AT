using System;
public class Person
{


        public Person(string name, int age)
    {
        Name = name;
        Age = age;
    }
        public string Name { get; set; }
    public int Age { get; set; }

    public void DisplayInfo()
    {
        Console.WriteLine($"Name: {Name}, Age: {Age}, Address: {Address}");
    }
}


